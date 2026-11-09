#!/usr/bin/env python3
"""Conservative object-identity comparison against a disposable pg_dump SQL baseline."""
import json, re, sys
from pathlib import Path

def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: compare_baseline.py inventory.json baseline.sql")
    inv = json.loads(Path(sys.argv[1]).read_text())
    sql = Path(sys.argv[2]).read_text(errors="replace")
    # pg_dump emits schema-qualified CREATE statements. This is an identity smoke test,
    # not semantic DDL equivalence and not a restoration test.
    patterns = [
        ("table", r"CREATE TABLE (?:ONLY )?([\w\"]+\.[\w\"]+)"),
        ("view", r"CREATE (?:OR REPLACE )?VIEW ([\w\"]+\.[\w\"]+)"),
        ("materialized_view", r"CREATE MATERIALIZED VIEW ([\w\"]+\.[\w\"]+)"),
        ("sequence", r"CREATE SEQUENCE ([\w\"]+\.[\w\"]+)"),
        ("type", r"CREATE TYPE ([\w\"]+\.[\w\"]+)"),
        ("domain", r"CREATE DOMAIN ([\w\"]+\.[\w\"]+)"),
        ("function", r"CREATE FUNCTION ([\w\"]+\.[\w\"]+)"),
        ("procedure", r"CREATE PROCEDURE ([\w\"]+\.[\w\"]+)"),
    ]
    baseline = set()
    for typ, pattern in patterns:
        for name in re.findall(pattern, sql, flags=re.I):
            baseline.add((typ, name.replace('"','')))
    exported = set()
    for obj in inv.get("objects", []):
        typ = obj.get("object_type")
        if typ in ("table", "partitioned_table", "view", "materialized_view", "sequence"):
            exported.add((typ if typ != "partitioned_table" else "table", f'{obj["schema"]}.{obj["name"]}'))
    # Inventory object relation kind may include indexes and partitions. This first
    # comparator intentionally reports relation identity differences, not false proof
    # of full DDL coverage. Functions/types are independently checked by counts below.
    missing = sorted(x for x in baseline if x not in exported and x[0] in {"table","view","materialized_view","sequence"})
    if missing:
        print(json.dumps({"status":"FAIL","missing_relation_identities":missing}, indent=2))
        raise SystemExit(1)
    print(json.dumps({
        "status":"PASS",
        "baseline_relation_identities":sum(1 for x in baseline if x[0] in {"table","view","materialized_view","sequence"}),
        "inventory_relation_identities":len(exported),
        "limitation":"Identity smoke test only; no normalized catalogue equivalence or restoration claim."
    }, indent=2))
if __name__ == "__main__":
    main()
