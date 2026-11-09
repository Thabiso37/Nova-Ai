#!/usr/bin/env python3
"""Strict metadata-only inventory prototype. PostgreSQL 17; no DDL generation."""
import argparse, json, os, re, sys, hashlib
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor

VERSION = "0.1.0"
CANARIES = ("CANARY_CUSTOMER_7f3c2a91", "CANARY_SELLER_8b1d4e62")
SECRET_PATTERNS = [
    re.compile(r"(?i)(password|passwd|secret|api[_-]?key|access[_-]?token)\\s*[:=]\\s*['\\"][^'\\"]+"),
    re.compile(r"(?i)(postgres|postgresql|mysql)://[^\\s'\\"]+"),
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
    args = ap.parse_args()
    dsn = os.environ.get("INVENTORY_DSN")
    if not dsn:
        raise SystemExit("INVENTORY_DSN is required; production DSNs are prohibited.")
    scope = json.load(open(args.scope, encoding="utf-8"))
    global PROVENANCE_OWNERS
    PROVENANCE_OWNERS = scope.get("owner_registry", {})
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
                AND n.nspname NOT LIKE 'pg_toast%'
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
                        "routines": funcs, "sequences": seqpriv, "schemas": schema_priv,
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
                     pg_get_userbyid(c.relowner) AS owner,c.relispartition,
                     CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
                       WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view'
                       WHEN 'S' THEN 'sequence' WHEN 'i' THEN 'index' WHEN 'I' THEN 'index'
                       ELSE 'relation' END AS object_type,
                     CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END AS view_definition
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname = ANY(%s) ORDER BY 1,2
            """, (list(allowed),))
            for obj in rels:
                obj["classification"] = PROVENANCE_OWNERS.get(obj.get("owner"), "UNCLASSIFIED")
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
                 WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "constraints": """SELECT n.nspname schema,c.relname relation,con.conname name,
                 con.contype kind,con.convalidated validated,con.condeferrable deferrable,
                 con.condeferred initially_deferred,pg_get_constraintdef(con.oid,true) definition,
                 t.typname domain_name
                 FROM pg_constraint con
                 LEFT JOIN pg_class c ON c.oid=con.conrelid
                 LEFT JOIN pg_namespace n ON n.oid=COALESCE(c.relnamespace,(SELECT typnamespace FROM pg_type WHERE oid=con.contypid))
                 LEFT JOIN pg_type t ON t.oid=con.contypid
                 WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "indexes": """SELECT n.nspname schema,t.relname table_name,i.relname index_name,
                 pg_get_indexdef(i.oid) definition,ix.indisunique is_unique,ix.indisvalid is_valid
                 FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid
                 JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "routines": """SELECT n.nspname schema,p.proname name,p.prokind kind,
                 pg_get_function_identity_arguments(p.oid) identity_arguments,
                 pg_get_function_result(p.oid) result_type,p.provolatile volatility,
                 p.prosecdef security_definer,p.proleakproof leakproof,
                 pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner
                 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname=ANY(%s) ORDER BY 1,2,4""",
              "triggers": """SELECT n.nspname schema,c.relname relation,t.tgname name,
                 pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled
                 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE NOT t.tgisinternal AND n.nspname=ANY(%s) ORDER BY 1,2,3""",
              "types": """SELECT n.nspname schema,t.typname name,t.typtype kind,
                 format_type(t.typbasetype,t.typtypmod) base_type,
                 pg_get_userbyid(t.typowner) owner
                 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                 WHERE n.nspname=ANY(%s) AND t.typrelid=0 ORDER BY 1,2""",
              "enums": """SELECT n.nspname schema,t.typname type_name,e.enumlabel label,e.enumsortorder sort_order
                 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
                 JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2,4""",
              "policies": """SELECT n.nspname schema,c.relname relation,p.polname name,p.polcmd command,
                 p.polpermissive permissive,p.polroles roles,pg_get_expr(p.polqual,p.polrelid) using_expression,
                 pg_get_expr(p.polwithcheck,p.polrelid) check_expression
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

            # Any schema in scope without an explicit owner classification is a hard failure.
            unclassified = [x for x in inventory["objects"] if x["classification"] == "UNCLASSIFIED"]
            unsupported = [x for x in inventory["objects"] if x["support"] == "UNSUPPORTED"]
            unresolved = []
            inventory["completeness"] = {
              "discovered_objects": len(inventory["objects"]),
              "classified_objects": len(inventory["objects"])-len(unclassified),
              "unclassified_objects": unclassified,
              "unsupported_objects": unsupported,
              "unresolved_dependencies": unresolved,
              "catalogue_visibility_failures": [],
              "secret_findings": secret_findings,
              "status": "PASS"
            }
            if unclassified or unsupported or secret_findings:
                inventory["completeness"]["status"] = "FAIL"
                raise RuntimeError("Inventory failed closed: unclassified, unsupported, or sensitive metadata found.")
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
        sys.exit(1)
