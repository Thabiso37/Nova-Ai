#!/usr/bin/env python3
"""Runtime negative tests executed as novaai_inventory_inspector.

Only synthetic disposable fixtures are targeted. Expected denials are recorded by
test name and SQLSTATE; exception text and values are never emitted.
"""
import json, os, sys
import psycopg2

DSN = os.environ.get("INVENTORY_DSN")
if not DSN:
    raise SystemExit("INVENTORY_DSN is required")
results = []

def denied(name, sql, params=None):
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(sql, params)
                results.append({"test": name, "status": "FAIL", "reason": "operation unexpectedly succeeded"})
            except psycopg2.Error as exc:
                state = exc.pgcode or "UNKNOWN"
                results.append({"test": name, "status": "PASS" if state in ("42501", "25006") else "FAIL",
                                "sqlstate": state})
    finally:
        conn.close()

def assertion(name, ok):
    results.append({"test": name, "status": "PASS" if ok else "FAIL"})

conn = psycopg2.connect(DSN)
try:
    with conn.cursor() as cur:
        cur.execute("""SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
                       AND NOT rolcreatedb AND NOT rolreplication AND NOT rolinherit
                       FROM pg_roles WHERE rolname=current_user""")
        assertion("restricted_role_attributes_and_no_inheritance", cur.fetchone()[0])
        cur.execute("""SELECT count(*)=0 FROM pg_auth_members m
                       JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user""")
        assertion("no_privileged_role_membership", cur.fetchone()[0])
        cur.execute("SELECT NOT has_table_privilege(current_user,'novaai_app.customers','SELECT')")
        assertion("effective_table_select_denied", cur.fetchone()[0])
        cur.execute("SELECT NOT has_column_privilege(current_user,'novaai_app.customers','email','SELECT')")
        assertion("effective_column_select_denied", cur.fetchone()[0])
finally:
    conn.close()

denied("protected_table_select", "SELECT id FROM novaai_app.customers")
denied("protected_column_select", "SELECT email FROM novaai_app.customers")
denied("view_row_access", "SELECT id FROM novaai_app.customer_view")
denied("materialized_view_access", "SELECT state FROM novaai_app.order_summary")
denied("invoker_function_execution", "SELECT novaai_app.customer_count()")
denied("security_definer_function_execution", "SELECT novaai_app.definer_probe()")
denied("sequence_nextval", "SELECT nextval('novaai_app.customers_id_seq'::regclass)")
denied("sequence_currval", "SELECT currval('novaai_app.customers_id_seq'::regclass)")
denied("large_object_create", "SELECT lo_create(0)")
denied("large_object_read", "SELECT lo_get(1::oid)")
denied("temporary_table_creation", "CREATE TEMP TABLE inspector_temp_probe(id integer)")
denied("schema_creation", "CREATE SCHEMA inspector_schema_probe")
denied("table_creation_in_scoped_schema", "CREATE TABLE novaai_app.inspector_table_probe(id integer)")
denied("protected_data_with_rls_disabled", "SELECT payload FROM novaai_app.rls_disabled_probe")
denied("privileged_role_inheritance_probe", "SELECT protected_value FROM novaai_app.inheritance_probe")
denied("sequence_setval_mutation", "SELECT setval('novaai_app.customers_id_seq'::regclass, 10)")
denied("large_object_write", "SELECT lo_put(0::oid, 0, decode('00','hex'))")
denied("large_object_unlink_mutation", "SELECT lo_unlink(0::oid)")

failed = [r for r in results if r["status"] != "PASS"]
print(json.dumps({"status": "FAIL" if failed else "PASS", "results": results}, sort_keys=True))
if failed:
    sys.exit(1)
