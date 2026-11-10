#!/usr/bin/env python3
"""Independent administrative dependency baseline for the disposable fixture.

Reads PostgreSQL catalogue metadata only; never selects application-table rows.
"""
import json, os, sys
import psycopg2

DSN=os.environ.get("BASELINE_DSN")
if not DSN:
    raise SystemExit("BASELINE_DSN is required")
scope=json.load(open("phase2/metadata-inventory/scope.json",encoding="utf-8"))
try:
    conn=psycopg2.connect(DSN)
    try:
        conn.set_session(isolation_level="REPEATABLE READ",readonly=True,autocommit=False)
        with conn.cursor() as cur:
            imported_snapshot=os.environ.get("CATALOGUE_SNAPSHOT_ID")
            if imported_snapshot:
                import re
                if not re.fullmatch(r"[0-9A-Fa-f-]+",imported_snapshot):
                    raise RuntimeError("Invalid imported snapshot identifier")
                cur.execute("SET TRANSACTION SNAPSHOT '"+imported_snapshot+"'")
            else:
                cur.execute("SELECT pg_export_snapshot()")
                imported_snapshot=cur.fetchone()[0]
            cur.execute("SHOW server_version_num")
            version=cur.fetchone()[0]
            if not str(version).startswith("170"):
                raise SystemExit("Only PostgreSQL 17 is supported")
            cur.execute("""
              SELECT d.deptype,
                     dep.type dependent_type,dep.schema dependent_schema,
                     dep.identity dependent_identity,
                     ref.type referenced_type,ref.schema referenced_schema,
                     ref.identity referenced_identity
              FROM pg_depend d
              CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid)
                AS dep(type,schema,name,identity)
              CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid)
                AS ref(type,schema,name,identity)
              WHERE dep.schema=ANY(%s) OR ref.schema=ANY(%s)
              ORDER BY 1,2,3,4,5,6,7
            """,(scope["schemas"],scope["schemas"]))
            edges=[]
            for row in cur.fetchall():
                edges.append({
                    "dependency_type":row[0],
                    "dependent_type":row[1],"dependent_schema":row[2],
                    "dependent_identity":row[3],
                    "referenced_type":row[4],"referenced_schema":row[5],
                    "referenced_identity":row[6]
                })
            cur.execute("""
              SELECT e.extname,e.extversion,n.nspname,pg_get_userbyid(e.extowner)
              FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
              ORDER BY e.extname
            """)
            extensions=[{"name":r[0],"version":r[1],"schema":r[2],"owner":r[3]} for r in cur.fetchall()]
        conn.commit()
    finally:
        conn.close()
    
except Exception as exc:
    print("DEPENDENCY BASELINE FAILED CLOSED: " + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
print(json.dumps({"postgres_version_num":version,"snapshot_id":imported_snapshot,"edge_count":len(edges),"edges":edges,"extensions":extensions},sort_keys=True))
