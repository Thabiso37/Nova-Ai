#!/usr/bin/env python3
"""Fail-closed discovery of unsupported PostgreSQL object families.

Only object identities are emitted. Sensitive fields such as user-mapping options,
subscription connection strings and security-label contents are never selected.
"""
import json, os, sys
import psycopg2

DSN = os.environ.get("INVENTORY_DSN")
if not DSN:
    raise SystemExit("INVENTORY_DSN is required")
scope = json.load(open("phase2/metadata-inventory/scope.json", encoding="utf-8"))
registry = json.load(open("phase2/metadata-inventory/provenance_registry.json", encoding="utf-8"))
schemas = scope["schemas"]
queries = [
    ("aggregate", """SELECT n.nspname schema,p.proname identity
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE p.prokind='a' AND n.nspname=ANY(%s)""", (schemas,)),
    ("rule", """SELECT n.nspname schema,c.relname||'.'||r.rulename identity
       FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE r.rulename<>'_RETURN' AND n.nspname=ANY(%s)""", (schemas,)),
    ("operator", """SELECT n.nspname schema,o.oprname identity
       FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("operator_class", """SELECT n.nspname schema,o.opcname identity
       FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("operator_family", """SELECT n.nspname schema,o.opfname identity
       FROM pg_opfamily o JOIN pg_namespace n ON n.oid=o.opfnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("foreign_table", """SELECT n.nspname schema,c.relname identity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind='f' AND n.nspname=ANY(%s)""", (schemas,)),
    ("foreign_data_wrapper", "SELECT NULL::text schema,fdwname identity FROM pg_foreign_data_wrapper", ()),
    ("foreign_server", "SELECT NULL::text schema,srvname identity FROM pg_foreign_server", ()),
    ("user_mapping", """SELECT NULL::text schema,
       COALESCE(r.rolname,'PUBLIC')||'@server_oid:'||m.umserver::text identity
       FROM pg_user_mapping m
       LEFT JOIN pg_roles r ON r.oid=m.umuser""", ()),
    ("event_trigger", "SELECT NULL::text schema,evtname identity FROM pg_event_trigger", ()),
    ("publication", "SELECT NULL::text schema,pubname identity FROM pg_publication", ()),
    ("subscription", "SELECT NULL::text schema,subname identity FROM pg_subscription", ()),
    ("text_search_configuration", """SELECT n.nspname schema,c.cfgname identity
       FROM pg_ts_config c JOIN pg_namespace n ON n.oid=c.cfgnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("text_search_dictionary", """SELECT n.nspname schema,d.dictname identity
       FROM pg_ts_dict d JOIN pg_namespace n ON n.oid=d.dictnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("text_search_parser", """SELECT n.nspname schema,p.prsname identity
       FROM pg_ts_parser p JOIN pg_namespace n ON n.oid=p.prsnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("text_search_template", """SELECT n.nspname schema,t.tmplname identity
       FROM pg_ts_template t JOIN pg_namespace n ON n.oid=t.tmplnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("extended_statistics", """SELECT n.nspname schema,s.stxname identity
       FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid=s.stxnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("collation", """SELECT n.nspname schema,c.collname identity
       FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("conversion", """SELECT n.nspname schema,c.conname identity
       FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("transform", """SELECT n.nspname schema,format_type(t.oid,NULL)||'@'||l.lanname identity
       FROM pg_transform x JOIN pg_type t ON t.oid=x.trftype
       JOIN pg_language l ON l.oid=x.trflang
       JOIN pg_namespace n ON n.oid=t.typnamespace
       WHERE n.nspname=ANY(%s)""", (schemas,)),
    ("user_defined_language", """SELECT NULL::text schema,lanname identity
       FROM pg_language WHERE lanname NOT IN ('internal','c','sql','plpgsql')""", ()),
    ("large_object_metadata", """SELECT NULL::text schema,
       count(oid)::text||' large objects present' identity
       FROM pg_largeobject_metadata HAVING count(oid)>0""", ()),
    ("custom_cast", """SELECT COALESCE(ns.nspname,nt.nspname) schema,
       format_type(c.castsource,NULL)||' -> '||format_type(c.casttarget,NULL) identity
       FROM pg_cast c
       JOIN pg_type st ON st.oid=c.castsource
       JOIN pg_namespace ns ON ns.oid=st.typnamespace
       JOIN pg_type tt ON tt.oid=c.casttarget
       JOIN pg_namespace nt ON nt.oid=tt.typnamespace
       WHERE ns.nspname=ANY(%s) OR nt.nspname=ANY(%s)""", (schemas,schemas)),
    ("unsupported_type_family", """SELECT n.nspname schema,t.typname identity
       FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
       LEFT JOIN pg_class c ON c.oid=t.typrelid
       WHERE n.nspname=ANY(%s) AND t.typelem=0
         AND ((t.typtype IN ('b','r','m','p') AND t.typrelid=0)
              OR (t.typtype='c' AND c.relkind='c'))""", (schemas,)),
    ("security_label", """SELECT x.schema_name schema,x.identity
       FROM pg_seclabel l
       CROSS JOIN LATERAL pg_identify_object(l.classoid,l.objoid,l.objsubid)
         AS x(type,schema_name,name,identity)
       WHERE x.schema_name=ANY(%s)""", (schemas,)),
    ("shared_security_label", """SELECT x.schema_name schema,x.identity
       FROM pg_shseclabel l
       CROSS JOIN LATERAL pg_identify_object(l.classoid,l.objoid,0)
         AS x(type,schema_name,name,identity)""", ())
]
registered_access_methods = {
    x["identity"]: x["classification"] for x in registry.get("external_prerequisites",[])
    if x.get("family")=="access_method" and x.get("classification") in ("CLUSTER_GLOBAL","EXTENSION_OWNED")
       and x.get("approved") is True
}
unsupported = []
visibility_failures = []
visibility_checks = []
positive_probe_families = {"rule","extended_statistics","unsupported_type_family","conversion","transform","security_label","shared_security_label","user_defined_language","text_search_parser","text_search_template","foreign_table","foreign_data_wrapper","foreign_server","user_mapping","publication","subscription","operator","operator_class","operator_family","aggregate","event_trigger","collation","text_search_configuration","text_search_dictionary","custom_cast","large_object_metadata"}
unverified_probe_families = sorted({q[0] for q in queries} - positive_probe_families)
catalogue_relations = {
 "aggregate":"pg_proc","rule":"pg_rewrite","operator":"pg_operator","operator_class":"pg_opclass",
 "operator_family":"pg_opfamily","foreign_table":"pg_class","foreign_data_wrapper":"pg_foreign_data_wrapper",
 "foreign_server":"pg_foreign_server","user_mapping":"pg_user_mapping","event_trigger":"pg_event_trigger",
 "publication":"pg_publication","subscription":"pg_subscription","text_search_configuration":"pg_ts_config",
 "text_search_dictionary":"pg_ts_dict","text_search_parser":"pg_ts_parser","text_search_template":"pg_ts_template",
 "extended_statistics":"pg_statistic_ext","collation":"pg_collation","conversion":"pg_conversion",
 "transform":"pg_transform","user_defined_language":"pg_language","large_object_metadata":"pg_largeobject_metadata",
 "custom_cast":"pg_cast","unsupported_type_family":"pg_type","security_label":"pg_seclabel",
 "shared_security_label":"pg_shseclabel"
}
classified_access_methods = []
try:
    conn = psycopg2.connect(DSN)
    try:
        conn.set_session(readonly=True, autocommit=False)
        with conn.cursor() as cur:
            cur.execute("SHOW server_version_num")
            version = cur.fetchone()[0]
            if not str(version).startswith("170"):
                raise SystemExit("Only PostgreSQL 17 is supported")
            for family, sql, params in queries:
                cur.execute("SAVEPOINT unsupported_scan")
                try:
                    cur.execute(sql, params)
                    found_rows = cur.fetchall()
                    for row in found_rows:
                        schema_name, identity = row[0], row[1]
                        unsupported.append({"family":family,"schema":schema_name,"identity":identity})
                    catalogue = catalogue_relations[family]
                    cur.execute("SELECT to_regclass(%s) IS NOT NULL, has_table_privilege(current_user,%s,'SELECT')",
                                ("pg_catalog."+catalogue, "pg_catalog."+catalogue))
                    relation_exists, relation_select = cur.fetchone()
                    if family == "user_mapping":
                        cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umuser','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umserver','SELECT')")
                        relation_select = cur.fetchone()[0]
                    if family == "foreign_data_wrapper":
                        cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_foreign_data_wrapper','fdwname','SELECT')")
                        relation_select = cur.fetchone()[0]
                    if family == "foreign_server":
                        cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_foreign_server','srvname','SELECT')")
                        relation_select = cur.fetchone()[0]
                    if family == "subscription":
                        cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_subscription','subname','SELECT')")
                        relation_select = cur.fetchone()[0]
                    if family == "security_label":
                        cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_seclabel','classoid','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_seclabel','objoid','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_seclabel','objsubid','SELECT')")
                        relation_select = cur.fetchone()[0]
                    if family == "shared_security_label":
                        cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_shseclabel','classoid','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_shseclabel','objoid','SELECT')")
                        relation_select = cur.fetchone()[0]
                    if family == "large_object_metadata":
                        cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_largeobject_metadata','oid','SELECT')")
                        relation_select = cur.fetchone()[0]
                    visible = bool(relation_exists and relation_select)
                    visibility_checks.append({"catalogue_family":family,"query_executed":True,
                        "catalogue_relation":catalogue,"catalogue_relation_visible":bool(relation_exists),
                        "required_select_permission":bool(relation_select),"objects_discovered":len(found_rows),
                        "expected_object_discoverability":"NOT_POSITIVELY_PROBED" if family in unverified_probe_families else "POSITIVE_PROBE_TESTED_IN_SEPARATE_STEP",
                        "status":"PASS" if visible else "FAIL"})
                    if not visible:
                        visibility_failures.append({"catalogue_family":family,"reason":"catalogue relation or required SELECT permission not visible"})
                    cur.execute("RELEASE SAVEPOINT unsupported_scan")
                except psycopg2.Error as exc:
                    cur.execute("ROLLBACK TO SAVEPOINT unsupported_scan")
                    visibility_failures.append({"catalogue_family":family,"sqlstate":exc.pgcode or "UNKNOWN"})
                    cur.execute("RELEASE SAVEPOINT unsupported_scan")
            cur.execute("SELECT amname FROM pg_am ORDER BY amname")
            for (name,) in cur.fetchall():
                if name in registered_access_methods:
                    classified_access_methods.append({"family":"access_method","identity":name,
                                                       "classification":registered_access_methods[name]})
                else:
                    unsupported.append({"family":"access_method","schema":None,"identity":name})
            cur.execute("SELECT to_regclass('pg_catalog.pg_am') IS NOT NULL,has_table_privilege(current_user,'pg_catalog.pg_am','SELECT')")
            am_exists,am_select=cur.fetchone()
            visibility_checks.append({"catalogue_family":"access_method","query_executed":True,
                "catalogue_relation":"pg_am","catalogue_relation_visible":bool(am_exists),
                "required_select_permission":bool(am_select),"objects_discovered":len(classified_access_methods),
                "expected_object_discoverability":"VERSION_PINNED_BUILTIN_REGISTRY","status":"PASS" if am_exists and am_select else "FAIL"})
            if not am_exists or not am_select:
                visibility_failures.append({"catalogue_family":"access_method","reason":"pg_am visibility or SELECT permission absent"})
        conn.commit()
    finally:
        conn.close()
    
except Exception as exc:
    print("UNSUPPORTED DETECTOR FAILED CLOSED: " + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
result = {
    "postgres_version_num":version,
    "unsupported_objects":unsupported,
    "catalogue_visibility_failures":visibility_failures,
    "catalogue_visibility_checks":visibility_checks,
    "unverified_probe_families":unverified_probe_families,
    "classified_access_methods":classified_access_methods,
    "status":"FAIL" if unsupported or visibility_failures else ("PARTIAL" if unverified_probe_families else "PASS"),
    "limitations":"Query execution and catalogue SELECT visibility are recorded separately. Security-label catalogues are positively exercised with synthetic catalogue rows; provider-specific SECURITY LABEL DDL is not exercised."
}
print(json.dumps(result,sort_keys=True))
if result["status"]=="FAIL":
    sys.exit(1)
