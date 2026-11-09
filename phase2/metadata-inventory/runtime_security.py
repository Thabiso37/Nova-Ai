#!/usr/bin/env python3
"""Runtime negative tests for the synthetic PostgreSQL 17 inspector role."""
import json
import os
import sys
import psycopg2

DSN = os.environ.get("INVENTORY_DSN")
if not DSN:
    raise SystemExit("INVENTORY_DSN is required")

results = []

def assertion(name, ok):
    results.append({"test": name, "status": "PASS" if bool(ok) else "FAIL"})

def denied(name, sql):
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(sql)
            except psycopg2.Error as exc:
                state = exc.pgcode or "UNKNOWN"
                results.append({
                    "test": name,
                    "status": "PASS" if state == "42501" else "FAIL",
                    "sqlstate": state
                })
            else:
                results.append({"test": name, "status": "FAIL",
                                "reason": "operation unexpectedly succeeded"})
    finally:
        conn.close()

def main():
    conn = psycopg2.connect(DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
                AND NOT rolcreatedb AND NOT rolreplication AND NOT rolinherit
                AND rolcanlogin FROM pg_roles WHERE rolname=current_user""")
            assertion("restricted_role_attributes", cur.fetchone()[0])

            cur.execute("""SELECT count(*)=0 FROM pg_auth_members m
                JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user""")
            assertion("no_role_memberships", cur.fetchone()[0])

            cur.execute("""SELECT count(*)=0 FROM pg_shdepend
                WHERE refclassid='pg_authid'::regclass
                  AND refobjid=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  AND deptype='o'
                  AND (dbid=0 OR dbid=(SELECT oid FROM pg_database WHERE datname=current_database()))""")
            assertion("inspector_owns_no_database_objects", cur.fetchone()[0])

            cur.execute("SELECT NOT has_database_privilege(current_user,current_database(),'CREATE') AND NOT has_database_privilege(current_user,current_database(),'TEMP')")
            assertion("database_create_and_temp_denied", cur.fetchone()[0])

            cur.execute("SELECT NOT has_table_privilege(current_user,'novaai_app.customers','SELECT')")
            assertion("effective_table_select_denied", cur.fetchone()[0])

            cur.execute("SELECT NOT has_column_privilege(current_user,'novaai_app.customers','email','SELECT')")
            assertion("effective_column_select_denied", cur.fetchone()[0])

            cur.execute("SELECT NOT has_type_privilege(current_user,'novaai_app.positive_amount','USAGE')")
            assertion("effective_user_defined_type_usage_denied", cur.fetchone()[0])

            cur.execute("""SELECT has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umuser','SELECT')
                AND has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umserver','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umoptions','SELECT')""")
            assertion("foreign_user_mapping_identity_only", cur.fetchone()[0])

            cur.execute("""SELECT has_column_privilege(current_user,'pg_catalog.pg_seclabel','classoid','SELECT')
                AND has_column_privilege(current_user,'pg_catalog.pg_seclabel','objoid','SELECT')
                AND has_column_privilege(current_user,'pg_catalog.pg_seclabel','objsubid','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_seclabel','label','SELECT')
                AND has_column_privilege(current_user,'pg_catalog.pg_shseclabel','classoid','SELECT')
                AND has_column_privilege(current_user,'pg_catalog.pg_shseclabel','objoid','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_shseclabel','label','SELECT')""")
            assertion("security_label_identity_only", cur.fetchone()[0])

            cur.execute("""SELECT has_column_privilege(current_user,'pg_catalog.pg_foreign_data_wrapper','fdwname','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_foreign_data_wrapper','fdwoptions','SELECT')
                AND has_column_privilege(current_user,'pg_catalog.pg_foreign_server','srvname','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_foreign_server','srvoptions','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_foreign_table','ftoptions','SELECT')
                AND has_column_privilege(current_user,'pg_catalog.pg_subscription','subname','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_subscription','subconninfo','SELECT')""")
            assertion("foreign_metadata_identity_only", cur.fetchone()[0])

            cur.execute("""SELECT has_column_privilege(current_user,'pg_catalog.pg_largeobject_metadata','oid','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_largeobject_metadata','lomowner','SELECT')
                AND NOT has_column_privilege(current_user,'pg_catalog.pg_largeobject_metadata','lomacl','SELECT')
                AND NOT has_table_privilege(current_user,'pg_catalog.pg_largeobject','SELECT')""")
            assertion("large_object_metadata_identity_only", cur.fetchone()[0])

            cur.execute("SELECT current_setting('search_path'), current_schemas(true)")
            path, schemas = cur.fetchone()
            assertion("effective_search_path_is_pg_catalog_only",
                      path == "pg_catalog" and schemas == ["pg_catalog"])
    finally:
        conn.close()

    operations = [
        ("protected_table_select", "SELECT id FROM novaai_app.customers"),
        ("protected_column_select", "SELECT email FROM novaai_app.customers"),
        ("foreign_user_mapping_options_read", "SELECT umoptions FROM pg_catalog.pg_user_mapping"),
        ("foreign_server_options_read", "SELECT srvoptions FROM pg_catalog.pg_foreign_server"),
        ("foreign_data_wrapper_options_read", "SELECT fdwoptions FROM pg_catalog.pg_foreign_data_wrapper"),
        ("foreign_table_options_read", "SELECT ftoptions FROM pg_catalog.pg_foreign_table"),
        ("subscription_connection_read", "SELECT subconninfo FROM pg_catalog.pg_subscription"),
        ("security_label_value_read", "SELECT label FROM pg_catalog.pg_seclabel"),
        ("shared_security_label_value_read", "SELECT label FROM pg_catalog.pg_shseclabel"),
        ("large_object_owner_read", "SELECT lomowner FROM pg_catalog.pg_largeobject_metadata"),
        ("large_object_content_read", "SELECT * FROM pg_catalog.pg_largeobject"),
        ("view_row_access", "SELECT id FROM novaai_app.customer_view"),
        ("materialized_view_access", "SELECT state FROM novaai_app.order_summary"),
        ("invoker_function_execution", "SELECT novaai_app.customer_count()"),
        ("security_definer_function_execution", "SELECT novaai_app.definer_probe()"),
        ("sequence_nextval", "SELECT nextval('novaai_app.customers_id_seq'::regclass)"),
        ("sequence_currval", "SELECT currval('novaai_app.customers_id_seq'::regclass)"),
        ("sequence_setval", "SELECT setval('novaai_app.customers_id_seq'::regclass,10)"),
        ("large_object_create", "SELECT lo_create(0)"),
        ("large_object_read", "SELECT lo_get(1::oid)"),
        ("large_object_read_range", "SELECT lo_get(1::oid,0::bigint,1::integer)"),
        ("large_object_from_bytea", "SELECT lo_from_bytea(0::oid,decode('00','hex'))"),
        ("large_object_write", "SELECT lo_put(0::oid,0,decode('00','hex'))"),
        ("large_object_unlink", "SELECT lo_unlink(0::oid)"),
        ("large_object_creat", "SELECT lo_creat(131072)"),
        ("large_object_import", "SELECT lo_import('/dev/null')"),
        ("large_object_import_with_oid", "SELECT lo_import('/dev/null',0::oid)"),
        ("large_object_export", "SELECT lo_export(0::oid,'/tmp/phase2-lo-probe')"),
        ("large_object_lowrite", "SELECT lowrite(0,decode('00','hex'))"),
        ("large_object_loread", "SELECT loread(0,1)"),
        ("large_object_open", "SELECT lo_open(0::oid,131072)"),
        ("large_object_truncate", "SELECT lo_truncate(0,0)"),
        ("large_object_truncate64", "SELECT lo_truncate64(0,0::bigint)"),
        ("large_object_close", "SELECT lo_close(0)"),
        ("large_object_lseek", "SELECT lo_lseek(0,0,0)"),
        ("large_object_lseek64", "SELECT lo_lseek64(0,0::bigint,0)"),
        ("large_object_tell", "SELECT lo_tell(0)"),
        ("large_object_tell64", "SELECT lo_tell64(0)"),
        ("temporary_table_creation", "CREATE TEMP TABLE inspector_temp_probe(id integer)"),
        ("schema_creation", "CREATE SCHEMA inspector_schema_probe"),
        ("table_creation_in_scoped_schema", "CREATE TABLE novaai_app.inspector_table_probe(id integer)"),
        ("protected_data_with_rls_disabled", "SELECT payload FROM novaai_app.rls_disabled_probe"),
        ("privileged_role_inheritance_probe", "SELECT protected_value FROM novaai_app.inheritance_probe"),
        ("set_role_privilege_escalation", "SET ROLE novaai_privileged_probe")
    ]
    for name, sql in operations:
        denied(name, sql)

    failed = [item for item in results if item["status"] != "PASS"]
    print(json.dumps({"status": "FAIL" if failed else "PASS",
                      "total": len(results), "passed": len(results)-len(failed),
                      "failed": len(failed), "results": results}, sort_keys=True))
    if failed:
        sys.exit(1)

try:
    main()
except Exception as exc:
    print("RUNTIME SECURITY TESTS FAILED CLOSED: " + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
