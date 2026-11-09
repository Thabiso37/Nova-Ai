#!/usr/bin/env python3
"""Keep one exported snapshot alive while inspector and admin processes import it."""
import os,re,subprocess,sys
import psycopg2
admin=os.environ.get("BASELINE_DSN")
if not admin or not os.environ.get("INVENTORY_DSN"):raise SystemExit("BASELINE_DSN and INVENTORY_DSN required")
try:
    conn=psycopg2.connect(admin)
    try:
     conn.set_session(isolation_level="REPEATABLE READ",readonly=True,autocommit=False)
     with conn.cursor() as cur:cur.execute("SELECT pg_export_snapshot()");sid=cur.fetchone()[0]
     if not re.fullmatch(r"[0-9A-Fa-f-]+",sid):raise RuntimeError("Invalid snapshot identifier")
     env=os.environ.copy();env["CATALOGUE_SNAPSHOT_ID"]=sid
     subprocess.run([sys.executable,"phase2/metadata-inventory/inventory.py","--output","inventory.json"],env=env,check=True)
     for script,outfile in [("baseline_dependencies.py","baseline-dependencies.json"),("catalogue_baseline.py","catalogue-baseline.json")]:
      with open(outfile,"w",encoding="utf-8") as out:
       subprocess.run([sys.executable,"phase2/metadata-inventory/"+script],env=env,stdout=out,check=True)
    finally:
     conn.rollback();conn.close()
    
except Exception as exc:
    print("SNAPSHOT COORDINATOR FAILED CLOSED: "+type(exc).__name__,file=sys.stderr)
    sys.exit(1)
