#!/usr/bin/env python3
"""Compare the metadata inventory with an independent disposable pg_dump baseline.

This is a catalogue/DDL coverage comparison, not a restore test or restoration-equivalence claim.
"""
import json, re, sys
from pathlib import Path

IDENT = r'(?:"?[A-Za-z_][A-Za-z0-9_]*"?)'
QUALIFIED = rf'{IDENT}\.{IDENT}'

def clean(value):
    return value.replace('"', '')

def add_missing(report, category, baseline, inventory):
    b, i = set(baseline), set(inventory)
    missing = sorted(b - i)
    extra = sorted(i - b)
    report[category] = {
        "baseline_count": len(b),
        "inventory_count": len(i),
        "missing_from_inventory": missing,
        "missing_from_baseline": extra,
        "status": "PASS" if not missing and not extra else "FAIL"
    }

def main():
    if len(sys.argv) not in (3,4,5):
        raise SystemExit("usage: compare_baseline.py inventory.json baseline.sql [unsupported.json] [baseline-extensions.sql]")
    inv = json.loads(Path(sys.argv[1]).read_text())
    sql = Path(sys.argv[2]).read_text(errors="replace")
    unsupported = json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv)>=4 else None
    extension_sql = Path(sys.argv[4]).read_text(errors="replace") if len(sys.argv)==5 else ""
    sections = inv.get("sections",{})
    report = {}

    table_blocks = {}
    table_pattern = re.compile(rf'CREATE TABLE\s+({QUALIFIED})\s*\((.*?)\n\);',re.I|re.S)
    for match in table_pattern.finditer(sql):
        name = clean(match.group(1))
        table_blocks[name] = match.group(2)

    tables = set(table_blocks)
    views = {clean(x) for x in re.findall(rf'CREATE VIEW\s+({QUALIFIED})\s+AS',sql,re.I)}
    matviews = {clean(x) for x in re.findall(rf'CREATE MATERIALIZED VIEW\s+({QUALIFIED})\s+AS',sql,re.I)}
    sequences = {clean(x) for x in re.findall(rf'SEQUENCE NAME\s+({QUALIFIED})',sql,re.I)}
    relations = tables | views | matviews | sequences
    inventory_relations = set()
    for obj in inv.get("objects",[]):
        typ = obj.get("object_type")
        if typ in ("table","partitioned_table","view","materialized_view","sequence"):
            inventory_relations.add(f'{obj["schema"]}.{obj["name"]}')
    add_missing(report,"relations_and_sequences",relations,inventory_relations)

    baseline_columns = set()
    for table, body in table_blocks.items():
        for line in body.splitlines():
            stripped = line.strip()
            if not stripped or stripped.upper().startswith("CONSTRAINT "):
                continue
            m = re.match(r'"?([A-Za-z_][A-Za-z0-9_]*)"?\s+',stripped)
            if m:
                baseline_columns.add(f"{table}.{m.group(1)}")
    inventory_columns = {
        f'{x["schema"]}.{x["relation"]}.{x["name"]}'
        for x in sections.get("columns",[])
        if f'{x["schema"]}.{x["relation"]}' in tables
    }
    add_missing(report,"table_columns",baseline_columns,inventory_columns)

    baseline_constraints = set()
    for table,name in re.findall(
        rf'ALTER TABLE ONLY\s+({QUALIFIED})\s+ADD CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?',
        sql,re.I
    ):
        baseline_constraints.add(f"{clean(table)}.{name}")
    for domain,name in re.findall(
        rf'CREATE DOMAIN\s+({QUALIFIED})[\s\S]*?\bCONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?',
        sql,re.I
    ):
        baseline_constraints.add(f"{clean(domain)}.{name}")
    inventory_constraints = {
        f'{x["schema"]}.{x.get("relation") or x.get("domain_name")}.{x["name"]}'
        for x in sections.get("constraints",[])
    }
    add_missing(report,"constraints",baseline_constraints,inventory_constraints)

    baseline_indexes = set()
    for name,table in re.findall(
        rf'CREATE\s+(?:UNIQUE\s+)?INDEX\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ON\s+(?:ONLY\s+)?({QUALIFIED})',
        sql,re.I
    ):
        schema = clean(table).split(".")[0]
        baseline_indexes.add(f"{schema}.{name}")
    inventory_indexes = {f'{x["schema"]}.{x["index_name"]}' for x in sections.get("indexes",[])}
    add_missing(report,"indexes",baseline_indexes,inventory_indexes)

    baseline_routines = {
        clean(x) for x in re.findall(rf'CREATE\s+(?:OR REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+({QUALIFIED})\s*\(',sql,re.I)
    }
    inventory_routines = {f'{x["schema"]}.{x["name"]}' for x in sections.get("routines",[])}
    add_missing(report,"functions_and_procedures",baseline_routines,inventory_routines)

    baseline_extensions = {
        clean(x) for x in re.findall(r'CREATE EXTENSION(?: IF NOT EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?',extension_sql,re.I)
    }
    inventory_extensions = {x["name"] for x in sections.get("extensions",[])}
    add_missing(report,"extensions",baseline_extensions,inventory_extensions)

    baseline_types = {
        clean(x) for x in re.findall(rf'CREATE TYPE\s+({QUALIFIED})\s+AS',sql,re.I)
    } | {
        clean(x) for x in re.findall(rf'CREATE DOMAIN\s+({QUALIFIED})\s+AS',sql,re.I)
    }
    inventory_types = {f'{x["schema"]}.{x["name"]}' for x in sections.get("types",[])}
    add_missing(report,"types_and_domains",baseline_types,inventory_types)

    baseline_triggers = set()
    for name,table in re.findall(
        rf'CREATE TRIGGER\s+"?([A-Za-z_][A-Za-z0-9_]*)"?[\s\S]*?\bON\s+({QUALIFIED})',
        sql,re.I
    ):
        baseline_triggers.add(f"{clean(table)}.{name}")
    inventory_triggers = {f'{x["schema"]}.{x["relation"]}.{x["name"]}' for x in sections.get("triggers",[])}
    add_missing(report,"triggers",baseline_triggers,inventory_triggers)

    baseline_policies = set()
    for name,table in re.findall(
        rf'CREATE POLICY\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ON\s+({QUALIFIED})',
        sql,re.I
    ):
        baseline_policies.add(f"{clean(table)}.{name}")
    inventory_policies = {f'{x["schema"]}.{x["relation"]}.{x["name"]}' for x in sections.get("policies",[])}
    add_missing(report,"rls_policies",baseline_policies,inventory_policies)

    baseline_partitions = set()
    for parent,child in re.findall(
        rf'ALTER TABLE ONLY\s+({QUALIFIED})\s+ATTACH PARTITION\s+({QUALIFIED})',
        sql,re.I
    ):
        baseline_partitions.add(f"{clean(parent)}->{clean(child)}")
    for parent,child in re.findall(
        rf'ALTER INDEX\s+({QUALIFIED})\s+ATTACH PARTITION\s+({QUALIFIED})',
        sql,re.I
    ):
        baseline_partitions.add(f"{clean(parent)}->{clean(child)}")
    inventory_partitions = {
        f'{x["parent_schema"]}.{x["parent_name"]}->{x["child_schema"]}.{x["child_name"]}'
        for x in sections.get("partitions",[])
    }
    add_missing(report,"partitions",baseline_partitions,inventory_partitions)

    baseline_rls = {
        clean(x) for x in re.findall(rf'ALTER TABLE\s+({QUALIFIED})\s+ENABLE ROW LEVEL SECURITY',sql,re.I)
    }
    inventory_rls = {
        f'{x["schema"]}.{x["name"]}' for x in inv.get("objects",[])
        if x.get("relrowsecurity")
    }
    add_missing(report,"rls_configuration",baseline_rls,inventory_rls)

    baseline_owners = {
        (clean(kind),clean(obj),owner)
        for kind,obj,owner in re.findall(
            rf'ALTER\s+(TABLE|SEQUENCE|VIEW|MATERIALIZED VIEW|INDEX|FUNCTION|PROCEDURE|TYPE|SCHEMA)\s+({QUALIFIED})\s+OWNER TO\s+("?[\w]+"?)',
            sql,re.I
        )
    }
    owner_records = []
    for x in sections.get("relation_acl",[]):
        owner_records.append(("relation",f'{x["schema"]}.{x["relation"]}',x.get("owner")))
    for x in sections.get("schema_acl",[]):
        owner_records.append(("schema",x["schema"],x.get("owner")))
    for x in sections.get("routine_acl",[]):
        owner_records.append(("routine",f'{x["schema"]}.{x["name"]}',x.get("owner")))
    for x in sections.get("type_acl",[]):
        owner_records.append(("type",f'{x["schema"]}.{x["name"]}',x.get("owner")))
    report["ownership"] = {
        "baseline_owner_statements": len(baseline_owners),
        "inventory_owner_records": len(owner_records),
        "inventory_owner_records_with_owner": sum(1 for x in owner_records if x[2]),
        "status": "PASS" if baseline_owners and owner_records else "FAIL",
        "limitation": "Owner records are compared for presence and coverage; exact ACL/owner semantic equivalence is not asserted."
    }

    grant_statements = [x.strip() for x in re.findall(r'^(?:GRANT|REVOKE)\b[^;]+;',sql,re.I|re.M)]
    acl_records = []
    for section in ("relation_acl","schema_acl","routine_acl","type_acl","column_acl","default_privileges"):
        acl_records.extend(sections.get(section,[]))
    report["acl_metadata"] = {
        "baseline_grant_revoke_statements": len(grant_statements),
        "inventory_acl_records": len(acl_records),
        "status": "PASS" if acl_records else "FAIL",
        "limitation": "ACL metadata is inventoried and baseline GRANT/REVOKE statements are counted; normalized privilege-by-privilege equivalence is not yet asserted."
    }

    inventory_dependency_keys = {
        x.get("dependent_resolution",{}).get("key")
        for x in sections.get("dependencies",[])
        if x.get("dependent_resolution",{}).get("status")=="RESOLVED_INVENTORY"
    } | {
        x.get("referenced_resolution",{}).get("key")
        for x in sections.get("dependencies",[])
        if x.get("referenced_resolution",{}).get("status")=="RESOLVED_INVENTORY"
    }
    registry_keys = {f'{x["family"]}|{x["identity"]}' for x in inv.get("catalogue_objects",[])}
    missing_dependency_nodes = sorted(x for x in inventory_dependency_keys if x not in registry_keys)
    report["dependencies"] = {
        "resolved_edges": len(sections.get("dependencies",[])),
        "inventory_dependency_nodes": len(inventory_dependency_keys),
        "missing_inventory_nodes": missing_dependency_nodes,
        "cycle_count": len(sections.get("dependency_cycles",[])),
        "cycle_review_required": bool(sections.get("dependency_cycles")),
        "status": "PASS" if not missing_dependency_nodes and not inv.get("completeness",{}).get("unresolved_dependencies") else "FAIL",
        "limitation": "Dependency nodes are checked against the provenance-backed inventory; pg_dump text is not a second independent dependency graph."
    }

    if unsupported is not None:
        report["unsupported_object_discovery"] = {
            "status": unsupported.get("status"),
            "unsupported_count": len(unsupported.get("unsupported_objects",[])),
            "visibility_failure_count": len(unsupported.get("catalogue_visibility_failures",[]))
        }

    failures = [name for name,item in report.items()
                if isinstance(item,dict) and item.get("status")=="FAIL"]
    if unsupported is not None and unsupported.get("status")!="PASS":
        failures.append("unsupported_object_discovery")
    result = {
        "status":"FAIL" if failures else "PASS",
        "failures":sorted(set(failures)),
        "categories":report,
        "restoration_equivalence":False,
        "limitation":"This compares catalogue/DDL coverage only. It does not reconstruct DDL, execute a restore, or establish restoration equivalence."
    }
    print(json.dumps(result,indent=2,sort_keys=True))
    if result["status"]!="PASS":
        raise SystemExit(1)

if __name__=="__main__":
    main()
