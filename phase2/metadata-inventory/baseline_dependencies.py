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
conn=psycopg2.connect(DSN)
try:
    conn.set_session(readonly=True,autocommit=False)
    with conn.cursor() as cur:
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
    conn.commit()
finally:
    conn.close()
print(json.dumps({"postgres_version_num":version,"edge_count":len(edges),"edges":edges},sort_keys=True))
