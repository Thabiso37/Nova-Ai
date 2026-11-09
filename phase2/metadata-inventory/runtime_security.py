#!/usr/bin/env python3
"""Runtime negative tests; only SQLSTATE 42501 proves a permission denial."""
import json,os,sys
import psycopg2
DSN=os.environ.get("INVENTORY_DSN")
if not DSN:raise SystemExit("INVENTORY_DSN required")
results=[]
def denied(name,sql):
 try:
    c=psycopg2.connect(DSN);c.autocommit=True
     try:
      with c.cursor() as cur:
       try:
        cur.execute(sql);results.append({"test":name,"status":"FAIL","reason":"operation unexpectedly succeeded"})
       except psycopg2.Error as exc:
        state=exc.pgcode or "UNKNOWN"
        results.append({"test":name,"status":"PASS" if state=="42501" else "FAIL","sqlstate":state})
     finally:c.close()
    def assertion(name,ok):results.append({"test":name,"status":"PASS" if ok else "FAIL"})
    c=psycopg2.connect(DSN)
    try:
     with c.cursor() as cur:
      cur.execute("""SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolinherit FROM pg_roles WHERE rolname=current_user""")
      assertion("restricted_role_attributes_and_no_inheritance",bool(cur.fetchone()[0]))
      cur.execute("SELECT count(*)=0 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user")
      assertion("no_privileged_role_membership",bool(cur.fetchone()[0]))
      cur.execute("SELECT NOT has_table_privilege(current_user,'novaai_app.customers','SELECT')")
      assertion("effective_table_select_denied",bool(cur.fetchone()[0]))
      cur.execute("SELECT NOT has_column_privilege(current_user,'novaai_app.customers','email','SELECT')")
      assertion("effective_column_select_denied",bool(cur.fetchone()[0]))
      cur.execute("SELECT NOT has_type_privilege(current_user,'novaai_app.positive_amount','USAGE')")
      assertion("effective_user_defined_type_usage_denied",bool(cur.fetchone()[0]))
      cur.execute("SELECT NOT has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umoptions','SELECT')")
      assertion("foreign_user_mapping_options_not_visible",bool(cur.fetchone()[0]))
      cur.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umuser','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umserver','SELECT')")
      assertion("foreign_user_mapping_identity_columns_visible",bool(cur.fetchone()[0]))
    finally:c.close()
    checks=[
    ("protected_table_select","SELECT id FROM novaai_app.customers"),
    ("protected_column_select","SELECT email FROM novaai_app.customers"),
    ("foreign_user_mapping_options_read","SELECT umoptions FROM pg_catalog.pg_user_mapping"),
    ("view_row_access","SELECT id FROM novaai_app.customer_view"),
    ("materialized_view_access","SELECT state FROM novaai_app.order_summary"),
    ("invoker_function_execution","SELECT novaai_app.customer_count()"),
    ("security_definer_function_execution","SELECT novaai_app.definer_probe()"),
    ("sequence_nextval","SELECT nextval('novaai_app.customers_id_seq'::regclass)"),
    ("sequence_currval","SELECT currval('novaai_app.customers_id_seq'::regclass)"),
    ("sequence_setval_mutation","SELECT setval('novaai_app.customers_id_seq'::regclass,10)"),
    ("large_object_lo_get","SELECT lo_get(0::oid)"),
    ("large_object_lo_get_slice","SELECT lo_get(0::oid,0::bigint,1)"),
    ("large_object_from_bytea","SELECT lo_from_bytea(0::oid,decode('00','hex'))"),
    ("large_object_put","SELECT lo_put(0::oid,0,decode('00','hex'))"),
    ("large_object_unlink","SELECT lo_unlink(0::oid)"),
    ("large_object_create","SELECT lo_create(0::oid)"),
    ("large_object_creat","SELECT lo_creat(131072)"),
    ("large_object_import","SELECT lo_import('/etc/hosts')"),
    ("large_object_import_oid","SELECT lo_import('/etc/hosts',0::oid)"),
    ("large_object_export","SELECT lo_export(0::oid,'/tmp/phase2-lo-export-probe')"),
    ("large_object_write","SELECT lowrite(0,decode('00','hex'))"),
    ("large_object_read","SELECT loread(0,1)"),
    ("large_object_open","SELECT lo_open(0::oid,131072)"),
    ("large_object_truncate","SELECT lo_truncate(0,0)"),
    ("large_object_truncate64","SELECT lo_truncate64(0,0)"),
    ("large_object_close","SELECT lo_close(0)"),
    ("large_object_seek","SELECT lo_lseek(0,0,0)"),
    ("large_object_seek64","SELECT lo_lseek64(0,0,0)"),
    ("large_object_tell","SELECT lo_tell(0)"),
    ("large_object_tell64","SELECT lo_tell64(0)"),
    ("temporary_table_creation","CREATE TEMP TABLE inspector_temp_probe(id integer)"),
    ("schema_creation","CREATE SCHEMA inspector_schema_probe"),
    ("table_creation_in_scoped_schema","CREATE TABLE novaai_app.inspector_table_probe(id integer)"),
    ("protected_data_with_rls_disabled","SELECT payload FROM novaai_app.rls_disabled_probe"),
    ("privileged_role_inheritance_probe","SELECT protected_value FROM novaai_app.inheritance_probe"),
    ("set_role_privilege_escalation","SET ROLE novaai_privileged_probe")]
    for name,sql in checks:denied(name,sql)
    
except Exception as exc:
    print("RUNTIME SECURITY TESTS FAILED CLOSED: " + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
failed=[x for x in results if x["status"]!="PASS"]
print(json.dumps({"status":"FAIL" if failed else "PASS","results":results},sort_keys=True))
if failed:sys.exit(1)
