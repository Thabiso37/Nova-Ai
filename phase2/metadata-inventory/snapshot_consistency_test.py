#!/usr/bin/env python3
"""Demonstrate that imported exported snapshots exclude a later committed catalogue DDL change."""
import json,os,sys
import psycopg2
dsn=os.environ.get("BASELINE_DSN")
if not dsn:raise SystemExit("BASELINE_DSN required")
try:
    name="phase2_snapshot_late_probe";exporter=psycopg2.connect(dsn);writer=None;reader=None
    r={"status":"FAIL","snapshot_id":None,"old_snapshot_sees_late_object":None,"fresh_snapshot_sees_late_object":None}
    try:
     exporter.set_session(isolation_level="REPEATABLE READ",readonly=True,autocommit=False)
     with exporter.cursor() as c:c.execute("SELECT pg_export_snapshot()");r["snapshot_id"]=c.fetchone()[0]
     writer=psycopg2.connect(dsn);writer.autocommit=True
     with writer.cursor() as c:
      c.execute("DROP TABLE IF EXISTS novaai_private."+name);c.execute("CREATE TABLE novaai_private."+name+"(id integer)")
     reader=psycopg2.connect(dsn);reader.set_session(isolation_level="REPEATABLE READ",readonly=True,autocommit=False)
     with reader.cursor() as c:
      c.execute("SET TRANSACTION SNAPSHOT '"+r["snapshot_id"]+"'")
      c.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='novaai_private' AND c.relname=%s",(name,))
      r["old_snapshot_sees_late_object"]=c.fetchone()[0]>0
     fresh=psycopg2.connect(dsn)
     try:
      with fresh.cursor() as c:
       c.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='novaai_private' AND c.relname=%s",(name,))
       r["fresh_snapshot_sees_late_object"]=c.fetchone()[0]>0
     finally:fresh.close()
     r["status"]="PASS" if r["old_snapshot_sees_late_object"] is False and r["fresh_snapshot_sees_late_object"] is True else "FAIL"
    finally:
     if reader:reader.rollback();reader.close()
     exporter.rollback();exporter.close()
     if writer:
      with writer.cursor() as c:c.execute("DROP TABLE IF EXISTS novaai_private."+name)
      writer.close()
    
except Exception as exc:
    print("SNAPSHOT CONSISTENCY TEST FAILED CLOSED: " + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
print(json.dumps(r,sort_keys=True))
if r["status"]!="PASS":sys.exit(1)
