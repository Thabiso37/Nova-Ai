#!/usr/bin/env python3
"""Strict metadata-only inventory prototype. PostgreSQL 17; no DDL generation."""
import argparse, json, os, re, sys, hashlib, traceback
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor

VERSION = "0.1.0"
CANARIES = ("CANARY_CUSTOMER_7f3c2a91", "CANARY_SELLER_8b1d4e62", "CANARY_RLS_DISABLED_91aa73")
SECRET_PATTERNS = [
    re.compile(r"""(?i)(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"]+"""),
    re.compile(r"""(?i)(postgres|postgresql|mysql)://[^\s'"]+"""),
    re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"(?i)sb_secret_[A-Za-z0-9_-]{12,}"),
    re.compile(r"(?i)supabase.{0,20}(service_role|secret).{0,20}[A-Za-z0-9_-]{12,}"),
]
SYSTEM_SCHEMAS = {"pg_catalog", "information_schema", "pg_toast"}
SUPPORTED = {
    "schema", "table", "partitioned_table", "partition", "view", "materialized_view",
    "sequence", "index", "function", "procedure", "trigger", "type", "domain", "enum",
    "constraint", "policy", "extension"
}
PROVENANCE_OWNERS = None  # Loaded from the explicit owner registry in scope.json.
PROVENANCE_CLASSES = {
    "NOVAAI_OWNED", "SUPABASE_MANAGED", "EXTENSION_OWNED",
    "CLUSTER_GLOBAL", "ENVIRONMENT_SPECIFIC"
}


def rows(cur, sql, args=None):
    cur.execute(sql, args or ())
    return [dict(r) for r in cur.fetchall()]

def scrub_scan(value, location, findings):
    if value is None: return
    text = str(value)
    for pattern in SECRET_PATTERNS:
        if pattern.search(text):
            findings.append({"location": location, "pattern": pattern.pattern, "status": "REJECTED"})
            break

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="inventory.json")
    ap.add_argument("--scope", default="phase2/metadata-inventory/scope.json")
    ap.add_argument("--registry", default="phase2/metadata-inventory/provenance_registry.json")
    args = ap.parse_args()
    dsn = os.environ.get("INVENTORY_DSN")
    if not dsn:
        raise SystemExit("INVENTORY_DSN is required; production DSNs are prohibited.")
    scope = json.load(open(args.scope, encoding="utf-8"))
    registry = json.load(open(args.registry, encoding="utf-8"))
    registry_objects = registry.get("objects", [])
    migration_ids = {x["migration_id"] for x in registry.get("migration_history", [])}
    registry_keys = [f"{x.get('family','')}|{x.get('identity','')}" for x in registry_objects]
    registry_violations = []
    if len(registry_keys) != len(set(registry_keys)):
        registry_violations.append("duplicate_object_identity")
    for entry in registry_objects:
        if entry.get("classification") not in PROVENANCE_CLASSES:
            registry_violations.append("unknown_object_classification")
        if entry.get("migration_id") not in migration_ids:
            registry_violations.append("missing_migration_evidence")
        if not entry.get("family") or not entry.get("identity"):
            registry_violations.append("incomplete_object_identity")
    for entry in registry.get("external_prerequisites", []):
        if entry.get("classification") not in PROVENANCE_CLASSES:
            registry_violations.append("unknown_external_classification")
        if entry.get("approved") is True and entry.get("evidence_migration_id") not in migration_ids:
            registry_violations.append("missing_external_migration_evidence")
    for entry in registry.get("approved_exclusions", []):
        if entry.get("classification") not in PROVENANCE_CLASSES:
            registry_violations.append("unknown_exclusion_classification")
    if registry_violations:
        print(json.dumps({"diagnostic":"provenance_registry_rejected",
                          "violation_count":len(registry_violations),
                          "violation_types":sorted(set(registry_violations))}), file=sys.stderr)
        raise RuntimeError("Provenance registry failed closed.")
    registry_entries = {f"{x['family']}|{x['identity']}": x for x in registry_objects}
    secret_findings = []
    inventory = {"format_version": 1, "exporter_version": VERSION,
                  "generated_at_utc": datetime.now(timezone.utc).isoformat(),
                  "snapshot": {}, "objects": [], "dependencies": [],
                  "security": {}, "completeness": {}}
    conn = psycopg2.connect(dsn)
    try:
        conn.set_session(isolation_level="REPEATABLE READ", readonly=True, autocommit=False)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT pg_export_snapshot() AS snapshot_id, current_database() AS db, current_user AS role, current_setting('server_version_num') AS version")
            snap = dict(cur.fetchone())
            inventory["snapshot"] = snap
            if not str(snap["version"]).startswith("170"):
                raise RuntimeError("Only PostgreSQL 17 is supported by this prototype.")

            # Security preflight: attributes, membership, ownership and effective privileges.
            role = rows(cur, """
              SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
                     rolreplication, rolbypassrls, rolcanlogin
              FROM pg_roles WHERE rolname = current_user
            """)[0]
            memberships = rows(cur, """
              SELECT parent.rolname AS granted_role, m.admin_option
              FROM pg_auth_members m
              JOIN pg_roles child ON child.oid=m.member
              JOIN pg_roles parent ON parent.oid=m.roleid
              WHERE child.rolname=current_user
            """)
            dbpriv = rows(cur, """
              SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create,
                     has_database_privilege(current_user, current_database(), 'TEMP') AS can_temp,
                     pg_get_userbyid(d.datdba) AS db_owner
              FROM pg_database d WHERE d.datname=current_database()
            """)[0]
            relpriv = rows(cur, """
              SELECT n.nspname AS schema, c.relname AS name, c.relkind,
                     pg_get_userbyid(c.relowner) AS owner,
                     has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
                     EXISTS (
                       SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r',c.relowner))) a
                       WHERE a.grantee=0 AND a.privilege_type='SELECT'
                     ) AS public_select
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname NOT IN ('pg_catalog','information_schema')
                AND n.nspname NOT LIKE 'pg_toast%%'
                AND c.relkind IN ('r','p','v','m','f','S')
              ORDER BY 1,2
            """)
            colpriv = rows(cur, """
              SELECT n.nspname AS schema,c.relname AS relation,a.attname AS column
              FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
              JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE a.attnum>0 AND NOT a.attisdropped
                AND n.nspname NOT IN ('pg_catalog','information_schema')
                AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT')
            """)
            owned = rows(cur, """
              SELECT n.nspname AS schema,c.relname AS name
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                AND n.nspname NOT IN ('pg_catalog','information_schema')
            """)
            funcs = rows(cur, """
              SELECT n.nspname AS schema,p.proname AS name,
                     pg_get_function_identity_arguments(p.oid) AS identity_args,
                     p.prosecdef AS security_definer,
                     has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
                     EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                             WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog','information_schema')
            """)
            seqpriv = rows(cur, """
              SELECT n.nspname AS schema,c.relname AS name,
                     has_sequence_privilege(current_user,c.oid,'USAGE') AS can_usage,
                     has_sequence_privilege(current_user,c.oid,'UPDATE') AS can_update
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')
            """)
            typepriv = rows(cur, """
              SELECT n.nspname AS schema,t.typname AS name,
                     has_type_privilege(current_user,t.oid,'USAGE') AS can_usage
              FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
              WHERE n.nspname NOT IN ('pg_catalog','information_schema')
                AND t.typelem=0
                AND t.typtype IN ('b','c','d','e','r','m')
              ORDER BY 1,2
            """)
            schema_priv = rows(cur, """
              SELECT n.nspname, has_schema_privilege(current_user,n.oid,'CREATE') AS can_create,
                     has_schema_privilege(current_user,n.oid,'USAGE') AS can_usage,
                     pg_get_userbyid(n.nspowner) AS owner
              FROM pg_namespace n
              WHERE n.nspname NOT IN ('pg_catalog','information_schema')
            """)
            lo_exec = rows(cur, """
              SELECT p.proname, has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
                     EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
                             WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='pg_catalog'
                AND p.proname IN ('lo_get','lo_from_bytea','lo_put','lo_unlink','lo_create','lo_creat','lo_import','lo_export','lowrite','loread','lo_open','lo_truncate')
            """)
            security = {"role": role, "memberships": memberships, "database": dbpriv,
                        "relations": relpriv, "columns": colpriv, "owned_relations": owned,
                        "routines": funcs, "sequences": seqpriv, "types": typepriv, "schemas": schema_priv,
                        "large_object_routines": lo_exec}
            inventory["security"] = security
            violations = []
            if role["rolsuper"] or role["rolbypassrls"] or role["rolcreaterole"] or role["rolcreatedb"] or role["rolreplication"] or not role["rolcanlogin"]:
                violations.append("role attributes violate restricted-login profile")
            if memberships: violations.append("role has memberships")
            if dbpriv["can_create"] or dbpriv["can_temp"]: violations.append("database CREATE/TEMP privilege present")
            if dbpriv["db_owner"] == snap["role"]: violations.append("inspection role owns database")
            if any(x["can_select"] for x in relpriv): violations.append("effective relation SELECT exists")
            if colpriv: violations.append("effective column SELECT exists")
            if owned: violations.append("inspection role owns application relation")
            if any(x["can_create"] for x in schema_priv): violations.append("schema CREATE privilege present")
            if any(x["can_usage"] or x["can_update"] for x in seqpriv): violations.append("sequence privileges present")
            if any(x["can_usage"] for x in typepriv): violations.append("user-defined type USAGE privilege present")
            if any(x["can_execute"] and (x["security_definer"] or x["schema"] not in ("pg_catalog","information_schema")) for x in funcs):
                violations.append("unapproved non-system or SECURITY DEFINER function EXECUTE present")
            if any(x["can_execute"] for x in lo_exec): violations.append("large-object routine EXECUTE privilege present")
            if violations:
                inventory["security"]["violations"] = violations
                raise RuntimeError("STRICT SECURITY PREFLIGHT FAILED: " + "; ".join(violations))

            allowed = set(scope["schemas"])
            # Inventory relations, columns, constraints, indexes, routines, triggers, types, policies, extensions.
            rels = rows(cur, """
              SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relpersistence,
                     pg_get_userbyid(c.relowner) AS owner,c.relispartition,c.relrowsecurity,c.relforcerowsecurity,
                     CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
                       WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view'
                       WHEN 'S' THEN 'sequence' WHEN 'i' THEN 'index' WHEN 'I' THEN 'index'
                       ELSE 'relation' END AS object_type,
                     CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END AS view_definition
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname = ANY(%s) ORDER BY 1,2
            """, (list(allowed),))
            for obj in rels:
                obj["classification"] = "UNCLASSIFIED"  # replaced by exact migration-backed registry below
                obj["support"] = obj["object_type"] if obj["object_type"] in SUPPORTED else "UNSUPPORTED"
                scrub_scan(obj.get("view_definition"), f'{obj["schema"]}.{obj["name"]}', secret_findings)
                inventory["objects"].append(obj)

            queries = {
              "columns": """SELECT n.nspname schema,c.relname relation,a.attnum ordinal,a.attname name,
                 format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,
                 pg_get_expr(d.adbin,d.adrelid) default_expression,a.attidentity identity_kind,
                 a.attgenerated generated_kind
                 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
                 WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f') AND n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "constraints": """SELECT n.nspname schema,c.relname relation,con.conname name,
                 con.contype kind,con.convalidated validated,con.condeferrable deferrable,
                 con.condeferred initially_deferred,pg_get_constraintdef(con.oid,true) definition,
                 t.typname domain_name,pg_get_userbyid(COALESCE(c.relowner,t.typowner)) owner
                 FROM pg_constraint con
                 LEFT JOIN pg_class c ON c.oid=con.conrelid
                 LEFT JOIN pg_namespace n ON n.oid=COALESCE(c.relnamespace,(SELECT typnamespace FROM pg_type WHERE oid=con.contypid))
                 LEFT JOIN pg_type t ON t.oid=con.contypid
                 WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "indexes": """SELECT n.nspname schema,t.relname table_name,i.relname index_name,
                 pg_get_indexdef(i.oid) definition,ix.indisunique is_unique,ix.indisvalid is_valid,
                 pg_get_userbyid(i.relowner) owner
                 FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid
                 JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "routines": """SELECT n.nspname schema,p.proname name,p.prokind kind,
                 pg_get_function_identity_arguments(p.oid) identity_arguments,
                 pg_get_function_result(p.oid) result_type,p.provolatile volatility,
                 p.prosecdef security_definer,p.proleakproof leakproof,
                 pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,
                 l.lanname language
                 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 JOIN pg_language l ON l.oid=p.prolang
                 WHERE n.nspname=ANY(%s) ORDER BY 1,2,4""",
              "triggers": """SELECT n.nspname schema,c.relname relation,t.tgname name,
                 pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled,
                 pg_get_userbyid(c.relowner) owner
                 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE NOT t.tgisinternal AND n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "types": """SELECT n.nspname schema,t.typname name,t.typtype kind,
                 format_type(t.typbasetype,t.typtypmod) base_type,
                 pg_get_userbyid(t.typowner) owner
                 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                 WHERE n.nspname=ANY(%s) AND t.typrelid=0 AND t.typelem=0 ORDER BY 1,2""",
              "enums": """SELECT n.nspname schema,t.typname type_name,e.enumlabel label,e.enumsortorder sort_order
                 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
                 JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2,4""",
              "policies": """SELECT n.nspname schema,c.relname relation,p.polname name,p.polcmd command,
                 p.polpermissive permissive,p.polroles roles,pg_get_expr(p.polqual,p.polrelid) using_expression,
                 pg_get_expr(p.polwithcheck,p.polrelid) check_expression,
                 pg_get_userbyid(c.relowner) owner
                 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "partitions": """SELECT pn.nspname parent_schema,pc.relname parent_name,
                 cn.nspname child_schema,cc.relname child_name,
                 pg_get_expr(cc.relpartbound,cc.oid,true) partition_bound
                 FROM pg_inherits h JOIN pg_class pc ON pc.oid=h.inhparent
                 JOIN pg_namespace pn ON pn.oid=pc.relnamespace
                 JOIN pg_class cc ON cc.oid=h.inhrelid JOIN pg_namespace cn ON cn.oid=cc.relnamespace
                 WHERE pn.nspname=ANY(%s) OR cn.nspname=ANY(%s) ORDER BY 1,2,3,4""",
              "extensions": """SELECT e.extname name,e.extversion version,n.nspname schema,
                 pg_get_userbyid(e.extowner) owner
                 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1""",
              "dependencies": """SELECT d.deptype dependency_type,
                 d.classid::regclass::text dependent_catalog,d.objid dependent_oid,
                 d.refclassid::regclass::text referenced_catalog,d.refobjid referenced_oid,
                 d.refobjsubid referenced_subobject
                 FROM pg_depend d ORDER BY 1,2,3,4,5"""
            }
            sections = {}
            for name, sql in queries.items():
                params = (list(allowed), list(allowed)) if name == "partitions" else (list(allowed),)
                sections[name] = rows(cur, sql, params)
                for idx, obj in enumerate(sections[name]):
                    for key, val in obj.items():
                        if isinstance(val, str) and ("definition" in key or "expression" in key):
                            scrub_scan(val, f"{name}[{idx}].{key}", secret_findings)
            inventory["sections"] = sections
            # Inventory ACLs/ownership as catalogue metadata, without reading relation contents.
            inventory["sections"]["relation_acl"] = rows(cur, """
              SELECT n.nspname schema,c.relname relation,pg_get_userbyid(c.relowner) owner,
                     c.relacl::text acl
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname=ANY(%s) ORDER BY 1,2
            """, (list(allowed),))
            inventory["sections"]["default_privileges"] = rows(cur, """
              SELECT n.nspname schema,pg_get_userbyid(d.defaclrole) owner,
                     d.defaclobjtype object_type,d.defaclacl::text acl
              FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
              WHERE d.defaclnamespace=0 OR n.nspname=ANY(%s)
            """, (list(allowed),))



            inventory["sections"]["schema_acl"] = rows(cur, """
              SELECT n.nspname schema,pg_get_userbyid(n.nspowner) owner,n.nspacl::text acl
              FROM pg_namespace n WHERE n.nspname=ANY(%s) ORDER BY 1
            """, (list(allowed),))
            inventory["sections"]["routine_acl"] = rows(cur, """
              SELECT n.nspname schema,p.proname name,
                     pg_get_function_identity_arguments(p.oid) identity_arguments,
                     pg_get_userbyid(p.proowner) owner,p.proacl::text acl
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname=ANY(%s) ORDER BY 1,2,3
            """, (list(allowed),))
            inventory["sections"]["type_acl"] = rows(cur, """
              SELECT n.nspname schema,t.typname name,pg_get_userbyid(t.typowner) owner,
                     t.typacl::text acl
              FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
              WHERE n.nspname=ANY(%s) AND t.typelem=0 ORDER BY 1,2
            """, (list(allowed),))
            inventory["sections"]["column_acl"] = rows(cur, """
              SELECT n.nspname schema,c.relname relation,a.attname column_name,
                     a.attacl::text acl
              FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
              JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
                AND n.nspname=ANY(%s) ORDER BY 1,2,3
            """, (list(allowed),))

            # Provenance is assigned only by exact registry entries backed by
            # the synthetic migration-history manifest. Owner values are corroboration,
            # never the sole source of classification.
            catalogue_objects = []
            def register_object(family, identity, owner=None, parent_owner=None):
                entry = registry_entries.get(f"{family}|{identity}")
                classification = "UNCLASSIFIED"
                evidence = None
                if entry and entry.get("migration_id") in migration_ids:
                    expected = entry.get("expected_owner")
                    expected_parent = entry.get("parent_owner")
                    owner_ok = (expected is None or owner == expected)
                    parent_ok = (expected_parent is None or parent_owner == expected_parent)
                    if owner_ok and parent_ok:
                        classification = entry["classification"]
                        evidence = entry["migration_id"]
                item = {"family": family, "identity": identity,
                        "classification": classification, "evidence": evidence}
                catalogue_objects.append(item)
                return classification

            schema_rows = rows(cur, """
              SELECT n.nspname name, pg_get_userbyid(n.nspowner) owner
              FROM pg_namespace n WHERE n.nspname=ANY(%s) ORDER BY 1
            """, (list(allowed),))
            for x in schema_rows:
                register_object("schema", x["name"], owner=x["owner"])

            for obj in inventory["objects"]:
                family = obj["object_type"]
                obj["classification"] = register_object(family, f'{obj["schema"]}.{obj["name"]}', owner=obj["owner"])

            relation_owners = {(x["schema"],x["name"]):x["owner"] for x in inventory["objects"]
                               if x["object_type"] in ("table","partitioned_table","view","materialized_view")}
            for x in sections["columns"]:
                if (x["schema"],x["relation"]) not in relation_owners:
                    continue
                register_object("column", f'{x["schema"]}.{x["relation"]}.{x["name"]}',
                                parent_owner=relation_owners[(x["schema"],x["relation"])])

            for x in sections["constraints"]:
                parent = x.get("relation") or x.get("domain_name")
                identity = f'{x["schema"]}.{parent}.{x["name"]}'
                register_object("constraint", identity, parent_owner=x.get("owner"))

            for x in sections["routines"]:
                register_object("routine", f'{x["schema"]}.{x["name"]}({x["identity_arguments"]})',
                                owner=x.get("owner"))

            for x in sections["triggers"]:
                register_object("trigger", f'{x["schema"]}.{x["relation"]}.{x["name"]}',
                                parent_owner=x.get("owner"))

            for x in sections["types"]:
                register_object("type", f'{x["schema"]}.{x["name"]}', owner=x.get("owner"))

            for x in sections["policies"]:
                register_object("policy", f'{x["schema"]}.{x["relation"]}.{x["name"]}',
                                parent_owner=x.get("owner"))

            for x in sections["extensions"]:
                register_object("extension", x["name"])

            inventory["catalogue_objects"] = catalogue_objects

            # Resolve pg_depend endpoints to PostgreSQL's stable object identities.
            dependency_rows = rows(cur, """
              SELECT d.deptype,
                     dep.type dependent_type, dep.schema dependent_schema,
                     dep.name dependent_name, dep.identity dependent_identity,
                     ref.type referenced_type, ref.schema referenced_schema,
                     ref.name referenced_name, ref.identity referenced_identity
              FROM pg_depend d
              CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid)
                AS dep(type,schema,name,identity)
              CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid)
                AS ref(type,schema,name,identity)
              WHERE dep.schema=ANY(%s) OR ref.schema=ANY(%s)
              ORDER BY 1,2,3,4,5
            """, (list(allowed),list(allowed)))

            supported_dependency_types = {
                "table":"table", "partitioned table":"partitioned_table",
                "view":"view", "materialized view":"materialized_view",
                "sequence":"sequence", "index":"index", "function":"routine",
                "procedure":"routine", "domain":"type", "type":"type",
                "enum":"type", "table column":"column", "materialized view column":"column",
                "schema":"schema", "extension":"extension", "constraint":"constraint",
                "table constraint":"constraint", "domain constraint":"constraint",
                "trigger":"trigger", "policy":"policy", "language":"language"
            }
            external_prerequisites = {
                (x["family"],x["identity"]):x
                for x in registry.get("external_prerequisites",[])
                if x.get("approved") is True
            }
            approved_exclusions = registry.get("approved_exclusions",[])
            dependency_edges = []
            unresolved_dependencies = []
            unsupported_dependencies = []
            def endpoint_resolution(prefix, row):
                typ = row[prefix+"_type"]
                schema_name = row[prefix+"_schema"]
                name = row[prefix+"_name"]
                identity = row[prefix+"_identity"]
                family = supported_dependency_types.get(typ)
                resolved_identity = identity

                if typ in ("constraint","table constraint","domain constraint","trigger","policy"):
                    match = re.match(r'(.+?) on (.+)$', identity)
                    if match:
                        object_name = match.group(1).strip('"')
                        target_parts = match.group(2).strip('"').split(".")
                        if len(target_parts)==2:
                            schema_name = target_parts[0].strip('"')
                            family = "constraint" if "constraint" in typ else typ
                            resolved_identity = f"{schema_name}.{target_parts[1].strip(chr(34))}.{object_name}"
                elif typ=="default value":
                    match = re.match(r"for (.+)$", identity)
                    if match:
                        parts = match.group(1).strip('"').split(".")
                        if len(parts)==3:
                            schema_name = parts[0].strip('"')
                            family = "column"
                            resolved_identity = ".".join(x.strip('"') for x in parts)
                        else:
                            family = None
                elif typ in ("table column","materialized view column"):
                    parts = identity.strip('"').split(".")
                    if len(parts)==3:
                        schema_name = parts[0].strip('"')
                        family = "column"
                        resolved_identity = ".".join(x.strip('"') for x in parts)
                elif typ=="rule":
                    match = re.match(r'(.+?) on (.+)$', identity)
                    if match:
                        target_parts = match.group(2).strip('"').split(".")
                        if len(target_parts)==2:
                            schema_name = target_parts[0].strip('"')
                            target_identity = f"{schema_name}.{target_parts[1].strip(chr(34))}"
                            family = ("view" if registry_entries.get(f"view|{target_identity}") else
                                      "materialized_view" if registry_entries.get(f"materialized_view|{target_identity}") else None)
                            resolved_identity = target_identity
                elif typ=="schema":
                    schema_name = name
                    resolved_identity = name
                elif typ in ("extension","language"):
                    resolved_identity = name

                if typ=="trigger" and "RI_ConstraintTrigger_" in identity:
                    match = re.search(r" on (.+)$", identity)
                    if match:
                        parts = match.group(1).strip('"').split(".")
                        if len(parts)==2:
                            rel_identity = f"{parts[0].strip(chr(34))}.{parts[1].strip(chr(34))}"
                            if any(registry_entries.get(f"{fam}|{rel_identity}") for fam in ("table","partitioned_table")):
                                return {"status":"RESOLVED_DERIVED_INTERNAL","key":f"relation|{rel_identity}"}

                if schema_name in allowed:
                    key = f"{family}|{resolved_identity}" if family else None
                    entry = registry_entries.get(key) if key else None
                    if not entry and family=="table":
                        alternate = f"partitioned_table|{resolved_identity}"
                        if alternate in registry_entries:
                            key, entry = alternate, registry_entries[alternate]
                    if entry and entry.get("migration_id") in migration_ids:
                        return {"status":"RESOLVED_INVENTORY","key":key}
                    if family is None:
                        unsupported_dependencies.append({"type":typ,"schema":schema_name,"identity":identity})
                        return {"status":"UNRESOLVED_UNSUPPORTED","key":None}
                    return {"status":"UNRESOLVED_MISSING_INVENTORY","key":key}

                external_key = (family,resolved_identity) if family else None
                if external_key and external_key in external_prerequisites:
                    return {"status":"RESOLVED_EXTERNAL_PREREQUISITE","key":f"{family}|{resolved_identity}"}
                qualified = f"{schema_name}.{identity}" if schema_name else identity
                for exclusion in approved_exclusions:
                    prefix_value = exclusion.get("identity_prefix","")
                    if prefix_value and qualified.startswith(prefix_value):
                        return {"status":"RESOLVED_APPROVED_EXCLUSION","key":qualified}
                    if schema_name and schema_name == exclusion.get("schema"):
                        return {"status":"RESOLVED_APPROVED_EXCLUSION","key":qualified}
                if schema_name in SYSTEM_SCHEMAS or (schema_name and schema_name.startswith("pg_toast")):
                    return {"status":"RESOLVED_CLUSTER_GLOBAL","key":qualified}
                return {"status":"UNRESOLVED_EXTERNAL_APPROVAL_REQUIRED","key":qualified}

            for d in dependency_rows:
                left = endpoint_resolution("dependent",d)
                right = endpoint_resolution("referenced",d)
                dependency_edges.append({
                    "dependency_type":d["deptype"],
                    "dependent_type":d["dependent_type"],
                    "dependent_schema":d["dependent_schema"],
                    "dependent_identity":d["dependent_identity"],
                    "dependent_resolution":left,
                    "referenced_type":d["referenced_type"],
                    "referenced_schema":d["referenced_schema"],
                    "referenced_identity":d["referenced_identity"],
                    "referenced_resolution":right
                })
                for side, result in (("dependent",left),("referenced",right)):
                    if result["status"].startswith("UNRESOLVED"):
                        unresolved_dependencies.append({
                            "side":side,"object_type":d[side+"_type"],
                            "schema":d[side+"_schema"],"identity":d[side+"_identity"],
                            "resolution":result["status"]
                        })
            # Include registry-backed generated catalogue objects (for example
            # implicit array types) that appear only as dependency endpoints.
            known_catalogue_keys = {f'{x["family"]}|{x["identity"]}' for x in catalogue_objects}
            for edge in dependency_edges:
                for side in ("dependent","referenced"):
                    resolution = edge[side+"_resolution"]
                    key = resolution.get("key")
                    if resolution.get("status")=="RESOLVED_INVENTORY" and key and key not in known_catalogue_keys:
                        entry = registry_entries.get(key)
                        if entry and entry.get("migration_id") in migration_ids:
                            catalogue_objects.append({
                                "family":entry["family"],"identity":entry["identity"],
                                "classification":entry["classification"],
                                "evidence":entry["migration_id"],
                                "generated_by":entry.get("generated_by","catalogue dependency")
                            })
                            known_catalogue_keys.add(key)
            inventory["catalogue_objects"] = catalogue_objects
            # Tarjan strongly-connected components identify dependency cycles.
            graph = {}
            for edge in dependency_edges:
                left = edge["dependent_resolution"]
                right = edge["referenced_resolution"]
                if left["status"] in ("RESOLVED_INVENTORY","RESOLVED_DERIVED_INTERNAL") and right["status"] in ("RESOLVED_INVENTORY","RESOLVED_DERIVED_INTERNAL"):
                    graph.setdefault(left["key"],set()).add(right["key"])
                    graph.setdefault(right["key"],set())
            index_counter = [0]
            stack = []
            on_stack = set()
            indices = {}
            lowlinks = {}
            dependency_cycles = []
            def strongconnect(node):
                indices[node] = index_counter[0]
                lowlinks[node] = index_counter[0]
                index_counter[0] += 1
                stack.append(node)
                on_stack.add(node)
                for target in graph.get(node,()):
                    if target not in indices:
                        strongconnect(target)
                        lowlinks[node] = min(lowlinks[node],lowlinks[target])
                    elif target in on_stack:
                        lowlinks[node] = min(lowlinks[node],indices[target])
                if lowlinks[node] == indices[node]:
                    component = []
                    while True:
                        target = stack.pop()
                        on_stack.remove(target)
                        component.append(target)
                        if target == node:
                            break
                    if len(component)>1 or (len(component)==1 and component[0] in graph.get(component[0],set())):
                        dependency_cycles.append({"members":sorted(component),"requires_special_handling":True})
            for node in graph:
                if node not in indices:
                    strongconnect(node)
            inventory["sections"]["dependency_cycles"] = dependency_cycles
            inventory["sections"]["dependencies"] = dependency_edges
            inventory["sections"]["unsupported_dependencies"] = unsupported_dependencies


            # Any schema/object without exact migration-backed provenance is a hard failure.
            unclassified = [x for x in catalogue_objects if x["classification"] == "UNCLASSIFIED"]
            unsupported = [x for x in inventory["objects"] if x["support"] == "UNSUPPORTED"]
            unresolved = unresolved_dependencies
            inventory["completeness"] = {
              "discovered_objects": len(inventory["objects"]),
              "classified_objects": len(catalogue_objects)-len(unclassified),
              "catalogue_object_count": len(catalogue_objects),
              "unclassified_objects": unclassified,
              "unsupported_objects": unsupported,
              "unresolved_dependencies": unresolved,
              "unsupported_dependency_types": unsupported_dependencies,
              "dependency_cycles": dependency_cycles,
              "cycle_handling": "Cycles are enumerated for independent ordering review; Phase 2 does not emit DDL or impose a restore order.",
              "catalogue_visibility_failures": [],
              "secret_findings": secret_findings,
              "status": "PASS"
            }
            if unclassified or unsupported or unresolved or unsupported_dependencies or secret_findings:
                inventory["completeness"]["status"] = "FAIL"
                print(json.dumps({
                    "diagnostic": "inventory_rejected",
                    "unclassified_count": len(unclassified),
                    "unclassified_families": sorted({x["family"] for x in unclassified}),
                    "unsupported_object_types": sorted({x.get("object_type","unknown") for x in unsupported}),
                    "unresolved_dependency_count": len(unresolved),
                    "unresolved_dependency_types": sorted({x["object_type"] for x in unresolved}),
                    "unsupported_dependency_types": sorted({x["type"] for x in unsupported_dependencies}),
                    "unresolved_dependency_samples": unresolved[:25],
                    "secret_finding_count": len(secret_findings)
                }), file=sys.stderr)
                raise RuntimeError("Inventory failed closed: unclassified, unsupported, unresolved, or sensitive metadata found.")
            if any(canary in json.dumps(inventory, default=str) for canary in CANARIES):
                raise RuntimeError("Synthetic canary detected in inventory output.")
            conn.commit()
    finally:
        conn.close()
    payload = json.dumps(inventory, indent=2, sort_keys=True, default=str)
    if any(canary in payload for canary in CANARIES):
        raise SystemExit("Canary leak blocked.")
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(payload + "\n")
    print(json.dumps({"status":"PASS","output":args.output,"sha256":hashlib.sha256(payload.encode()).hexdigest(),
                      "objects":len(inventory["objects"]),"version":VERSION}))
if __name__ == "__main__":
    try: main()
    except Exception as exc:
        # Never echo query values or secret-bearing metadata.
        print(f"INVENTORY FAILED CLOSED: {type(exc).__name__}: {str(exc)[:300]}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(1)
