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
    ("user_mapping", """SELECT NULL::text schema,m.usename||'@'||m.srvname identity
       FROM pg_user_mappings m""", ()),
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
       count(*)::text||' large objects present' identity
       FROM pg_largeobject_metadata HAVING count(*)>0""", ()),
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
       WHERE x.schema_name=ANY(%s)""", (schemas,))
]
built_in_access_methods = {
    x["identity"] for x in registry.get("external_prerequisites",[])
    if x.get("family")=="access_method" and x.get("classification")=="CLUSTER_GLOBAL"
       and x.get("approved") is True
}
unsupported = []
visibility_failures = []
cluster_global_access_methods = []
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
                for row in cur.fetchall():
                    schema_name, identity = row[0], row[1]
                    unsupported.append({"family":family,"schema":schema_name,"identity":identity})
                cur.execute("RELEASE SAVEPOINT unsupported_scan")
            except psycopg2.Error as exc:
                cur.execute("ROLLBACK TO SAVEPOINT unsupported_scan")
                visibility_failures.append({"catalogue_family":family,"sqlstate":exc.pgcode or "UNKNOWN"})
                cur.execute("RELEASE SAVEPOINT unsupported_scan")
        cur.execute("SELECT amname FROM pg_am ORDER BY amname")
        for (name,) in cur.fetchall():
            if name in built_in_access_methods:
                cluster_global_access_methods.append({"family":"access_method","identity":name,
                                                       "classification":"CLUSTER_GLOBAL"})
            else:
                unsupported.append({"family":"access_method","schema":None,"identity":name})
    conn.commit()
finally:
    conn.close()
result = {
    "postgres_version_num":version,
    "unsupported_objects":unsupported,
    "catalogue_visibility_failures":visibility_failures,
    "cluster_global_access_methods":cluster_global_access_methods,
    "status":"FAIL" if unsupported or visibility_failures else "PASS",
    "limitations":"A clean scan establishes only visibility for the listed catalogue families in this disposable fixture."
}
print(json.dumps(result,sort_keys=True))
if result["status"]!="PASS":
    sys.exit(1)
