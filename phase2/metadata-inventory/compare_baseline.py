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
        raise SystemExit("usage: compare_baseline.py inventory.json baseline.sql [unsupported.json] [provenance_registry.json]")
    inv = json.loads(Path(sys.argv[1]).read_text())
    sql = Path(sys.argv[2]).read_text(errors="replace")
    unsupported = json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv)>=4 else None
    registry = json.loads(Path(sys.argv[4]).read_text()) if len(sys.argv)==5 else {"external_prerequisites":[]}
    sections = inv.get("sections",{})
    report = {}

    table_blocks = {}
    table_pattern = re.compile(rf'CREATE TABLE\s+({QUALIFIED})\s*\((.*?)\n\)(?:\s*PARTITION BY[^;]+)?;',re.I|re.S)
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


    def norm_sql(value):
        return re.sub(r'\s+',' ',value.replace('"','').strip()).lower()

    baseline_column_properties = {}
    for table, body in table_blocks.items():
        for line in body.splitlines():
            stripped = line.strip().rstrip(",")
            if not stripped or stripped.upper().startswith("CONSTRAINT "):
                continue
            m = re.match(r'"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(.+)
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
    for table,name in re.findall(
        rf'ALTER TABLE ONLY\s+({QUALIFIED})\s+ADD CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(?:PRIMARY KEY|UNIQUE)\b',
        sql,re.I
    ):
        schema = clean(table).split(".")[0]
        baseline_indexes.add(f"{schema}.{name}")
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

    inventory_extensions = {x["name"] for x in sections.get("extensions",[])}
    approved_extensions = {
        x["identity"] for x in registry.get("external_prerequisites",[])
        if x.get("family")=="extension" and x.get("classification")=="EXTENSION_OWNED"
           and x.get("approved") is True
    }
    report["extensions"] = {
        "inventory_count":len(inventory_extensions),
        "approved_external_prerequisites":sorted(approved_extensions),
        "unapproved_inventory_extensions":sorted(inventory_extensions-approved_extensions),
        "status":"PASS" if inventory_extensions <= approved_extensions else "FAIL",
        "limitation":"The selected application-schema pg_dump omits the built-in pg_catalog plpgsql extension; its provenance is checked against the explicit external-prerequisite registry, not falsely treated as a DDL dump match."
    }


    routine_property_mismatches = []
    for routine in sections.get("routines",[]):
        identity = f'{routine["schema"]}.{routine["name"]}({routine["identity_arguments"]})'
        escaped = re.escape(f'{routine["schema"]}.{routine["name"]}')
        match = re.search(rf'CREATE\s+(?:OR REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+{escaped}\s*\([^)]*\)([\s\S]*?)(?=ALTER\s+(?:FUNCTION|PROCEDURE)|-- Name:|$)',sql,re.I)
        if not match:
            routine_property_mismatches.append((identity,"missing_definition"))
            continue
        body = match.group(1)
        language_match = re.search(r'\bLANGUAGE\s+([A-Za-z_][A-Za-z0-9_]*)',body,re.I)
        returns_match = re.search(r'\bRETURNS\s+([^\s]+)',body,re.I)
        volatility = "i" if re.search(r'\bIMMUTABLE\b',body,re.I) else "s" if re.search(r'\bSTABLE\b',body,re.I) else "v"
        security_definer = bool(re.search(r'\bSECURITY\s+DEFINER\b',body,re.I))
        if language_match and language_match.group(1).lower() != str(routine.get("language","")).lower():
            routine_property_mismatches.append((identity,"language",language_match.group(1),routine.get("language")))
        if returns_match and norm_sql(returns_match.group(1)) != norm_sql(routine["result_type"]):
            routine_property_mismatches.append((identity,"result_type",returns_match.group(1),routine["result_type"]))
        if volatility != routine["volatility"]:
            routine_property_mismatches.append((identity,"volatility",volatility,routine["volatility"]))
        if security_definer != bool(routine["security_definer"]):
            routine_property_mismatches.append((identity,"security_definer",security_definer,routine["security_definer"]))
    report["routine_properties"] = {
        "compared_routines":len(sections.get("routines",[])),
        "mismatches":routine_property_mismatches,
        "status":"PASS" if not routine_property_mismatches else "FAIL"
    }

    baseline_types = {
        clean(x) for x in re.findall(rf'CREATE TYPE\s+({QUALIFIED})\s+AS',sql,re.I)
    } | {
        clean(x) for x in re.findall(rf'CREATE DOMAIN\s+({QUALIFIED})\s+AS',sql,re.I)
    }
    inventory_types = {f'{x["schema"]}.{x["name"]}' for x in sections.get("types",[])}
    add_missing(report,"types_and_domains",baseline_types,inventory_types)


    baseline_enum_labels = {}
    for match in re.finditer(rf'CREATE TYPE\s+({QUALIFIED})\s+AS ENUM\s*\((.*?)\);',sql,re.I|re.S):
        baseline_enum_labels[clean(match.group(1))] = re.findall(r"'((?:[^']|'')*)'",match.group(2))
    inventory_enum_labels = {}
    for item in sections.get("enums",[]):
        inventory_enum_labels.setdefault(f'{item["schema"]}.{item["type_name"]}',[]).append((item["sort_order"],item["label"]))
    inventory_enum_labels = {key:[label for _,label in sorted(value)] for key,value in inventory_enum_labels.items()}
    enum_mismatches = []
    for key in sorted(set(baseline_enum_labels)|set(inventory_enum_labels)):
        if baseline_enum_labels.get(key) != inventory_enum_labels.get(key):
            enum_mismatches.append((key,baseline_enum_labels.get(key),inventory_enum_labels.get(key)))
    baseline_domain_bases = {}
    for match in re.finditer(rf'CREATE DOMAIN\s+({QUALIFIED})\s+AS\s+([^\s;]+(?:\([^)]*\))?)',sql,re.I):
        baseline_domain_bases[clean(match.group(1))] = norm_sql(match.group(2))
    inventory_domain_bases = {
        f'{x["schema"]}.{x["name"]}':norm_sql(x["base_type"])
        for x in sections.get("types",[]) if x.get("kind")=="d"
    }
    domain_mismatches = [
        (key,baseline_domain_bases.get(key),inventory_domain_bases.get(key))
        for key in sorted(set(baseline_domain_bases)|set(inventory_domain_bases))
        if baseline_domain_bases.get(key) != inventory_domain_bases.get(key)
    ]
    report["type_properties"] = {
        "enum_types_compared":len(set(baseline_enum_labels)&set(inventory_enum_labels)),
        "domain_types_compared":len(set(baseline_domain_bases)&set(inventory_domain_bases)),
        "enum_label_mismatches":enum_mismatches,
        "domain_base_type_mismatches":domain_mismatches,
        "status":"PASS" if not enum_mismatches and not domain_mismatches else "FAIL"
    }

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

    baseline_owner_map = {}
    owner_pattern = re.compile(
        rf'ALTER\s+(MATERIALIZED VIEW|TABLE|SEQUENCE|VIEW|INDEX|FUNCTION|PROCEDURE|TYPE|DOMAIN|SCHEMA)\s+({QUALIFIED}|{IDENT})(?:\([^;]*?\))?\s+OWNER TO\s+("?[\w]+"?)\s*;',
        re.I
    )
    for kind,obj,owner in owner_pattern.findall(sql):
        baseline_owner_map[clean(obj)] = clean(owner)

    inventory_owner_map = {}
    for x in sections.get("schema_acl",[]):
        inventory_owner_map[x["schema"]] = x.get("owner")
    for x in inv.get("objects",[]):
        if x.get("object_type") in ("table","partitioned_table","view","materialized_view"):
            inventory_owner_map[f'{x["schema"]}.{x["name"]}'] = x.get("owner")
    for x in sections.get("routines",[]):
        inventory_owner_map[f'{x["schema"]}.{x["name"]}({x["identity_arguments"]})'] = x.get("owner")
    for x in sections.get("types",[]):
        inventory_owner_map[f'{x["schema"]}.{x["name"]}'] = x.get("owner")
    owner_missing = sorted(set(inventory_owner_map)-set(baseline_owner_map))
    owner_extra = sorted(set(baseline_owner_map)-set(inventory_owner_map))
    owner_mismatches = sorted(
        (key,inventory_owner_map[key],baseline_owner_map[key])
        for key in set(inventory_owner_map)&set(baseline_owner_map)
        if inventory_owner_map[key] != baseline_owner_map[key]
    )
    report["ownership"] = {
        "baseline_owner_records":len(baseline_owner_map),
        "inventory_owner_records":len(inventory_owner_map),
        "missing_from_baseline":owner_missing,
        "missing_from_inventory":owner_extra,
        "mismatched_owners":owner_mismatches,
        "status":"PASS" if not owner_missing and not owner_extra and not owner_mismatches else "FAIL",
        "limitation":"Exact owners are compared for schemas, top-level relations, routines and explicit user-defined types; generated index/sequence/row-type ownership follows the owning relation or type and is validated by the provenance/owner preflight."
    }

    acl_inventory = {}
    def collect_acl(kind,identity,acl,owner):
        if not acl:
            return
        for item in acl.strip("{}").split(","):
            match = re.match(r"([^=]*)=([^/]*)/(.*)$",item)
            if not match:
                continue
            grantee = match.group(1) or "PUBLIC"
            if grantee == owner:
                continue
            privileges = set(match.group(2).replace("*",""))
            acl_inventory[(kind,identity,grantee)] = privileges

    for x in sections.get("schema_acl",[]):
        collect_acl("SCHEMA",x["schema"],x.get("acl"),x.get("owner"))
    relation_type = {
        (x["schema"],x["name"]):x.get("object_type")
        for x in inv.get("objects",[])
    }
    for x in sections.get("relation_acl",[]):
        typ = relation_type.get((x["schema"],x["relation"]))
        kind = {"table":"TABLE","partitioned_table":"TABLE","view":"TABLE",
                "materialized_view":"TABLE","sequence":"SEQUENCE","index":"INDEX"}.get(typ)
        if kind:
            collect_acl(kind,f'{x["schema"]}.{x["relation"]}',x.get("acl"),x.get("owner"))
    for x in sections.get("routine_acl",[]):
        collect_acl("FUNCTION",f'{x["schema"]}.{x["name"]}({x["identity_arguments"]})',x.get("acl"),x.get("owner"))
    for x in sections.get("type_acl",[]):
        collect_acl("TYPE",f'{x["schema"]}.{x["name"]}',x.get("acl"),x.get("owner"))
    for x in sections.get("column_acl",[]):
        collect_acl("COLUMN",f'{x["schema"]}.{x["relation"]}.{x["column_name"]}',x.get("acl"),None)

    privilege_letters = {
        "SELECT":"r","INSERT":"a","UPDATE":"w","DELETE":"d","TRUNCATE":"D",
        "REFERENCES":"x","TRIGGER":"t","EXECUTE":"X","USAGE":"U","CREATE":"C",
        "MAINTAIN":"m"
    }
    baseline_acl = {}
    baseline_revokes = []
    acl_pattern = re.compile(
        r'^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(SCHEMA|TABLE|SEQUENCE|FUNCTION|PROCEDURE|TYPE)\s+(.+?)\s+(TO|FROM)\s+([^;]+);',
        re.I|re.M
    )
    for action,priv_text,kind,obj,connector,grantees in acl_pattern.findall(sql):
        identity = clean(obj.strip())
        for grantee in (x.strip().replace('"',"") for x in grantees.split(",")):
            key = (kind.upper(),identity,grantee or "PUBLIC")
            if action.upper()=="REVOKE":
                baseline_revokes.append((key,priv_text.upper()))
                continue
            letters = set()
            for privilege in (x.strip().upper() for x in priv_text.split(",")):
                if privilege=="ALL":
                    letters.update("r a w d D x t m".split())
                    if kind.upper()=="SCHEMA":
                        letters.update(("U","C"))
                    elif kind.upper() in ("FUNCTION","PROCEDURE"):
                        letters.add("X")
                    elif kind.upper()=="TYPE":
                        letters.add("U")
                elif privilege in privilege_letters:
                    letters.add(privilege_letters[privilege])
            baseline_acl[key] = letters

    acl_missing = sorted(
        (key,sorted(value)) for key,value in acl_inventory.items()
        if baseline_acl.get(key,set()) != value
    )
    acl_extra = sorted(
        (key,sorted(value)) for key,value in baseline_acl.items()
        if acl_inventory.get(key,set()) != value
    )
    revoke_violations = sorted(
        (key,sorted(acl_inventory.get(key,set())))
        for key,_ in baseline_revokes if acl_inventory.get(key,set())
    )
    report["acl_metadata"] = {
        "baseline_grant_statements":len(baseline_acl),
        "baseline_revoke_statements":len(baseline_revokes),
        "inventory_non_owner_acl_entries":len(acl_inventory),
        "grant_mismatches":acl_missing,
        "unexpected_baseline_grants":acl_extra,
        "revoke_violations":revoke_violations,
        "status":"PASS" if not acl_missing and not acl_extra and not revoke_violations else "FAIL",
        "limitation":"Compares explicit non-owner grants and PUBLIC revocations for the disposable fixture. Default privilege semantics outside these statements remain separately inventoried."
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
,stripped)
            if not m:
                continue
            col_name, rest = m.group(1), m.group(2)
            suffix = re.search(r'\s+(NOT NULL|NULL|DEFAULT|GENERATED|COLLATE|COMPRESSION|STORAGE)\b',rest,re.I)
            data_type = rest[:suffix.start()].strip() if suffix else rest.strip()
            baseline_column_properties[f"{table}.{col_name}"] = {
                "data_type":norm_sql(data_type),
                "not_null":bool(re.search(r'\bNOT NULL\b',rest,re.I)),
                "has_default":bool(re.search(r'\bDEFAULT\b',rest,re.I)),
                "generated":bool(re.search(r'\bGENERATED\b',rest,re.I))
            }
    identity_modes = {}
    for table,column,mode in re.findall(
        rf'ALTER TABLE\s+({QUALIFIED})\s+ALTER COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD GENERATED\s+(ALWAYS|BY DEFAULT)\s+AS IDENTITY',
        sql,re.I
    ):
        identity_modes[f"{clean(table)}.{column}"] = "a" if mode.upper()=="ALWAYS" else "d"
    inventory_column_properties = {}
    for x in sections.get("columns",[]):
        relation = f'{x["schema"]}.{x["relation"]}'
        if relation not in tables:
            continue
        key = f'{relation}.{x["name"]}'
        inventory_column_properties[key] = {
            "data_type":norm_sql(x["data_type"]),
            "not_null":bool(x["not_null"]),
            "has_default":x.get("default_expression") is not None,
            "generated":bool(x.get("generated_kind"))
        }
    column_type_mismatches = []
    column_nullability_mismatches = []
    column_default_mismatches = []
    column_generated_mismatches = []
    for key in sorted(set(baseline_column_properties)&set(inventory_column_properties)):
        b, i = baseline_column_properties[key], inventory_column_properties[key]
        if b["data_type"] != i["data_type"]:
            column_type_mismatches.append((key,b["data_type"],i["data_type"]))
        if b["not_null"] != i["not_null"]:
            column_nullability_mismatches.append((key,b["not_null"],i["not_null"]))
        if b["has_default"] != i["has_default"]:
            column_default_mismatches.append((key,b["has_default"],i["has_default"]))
        if b["generated"] != i["generated"]:
            column_generated_mismatches.append((key,b["generated"],i["generated"]))
    identity_mismatches = []
    for key,x in inventory_column_properties.items():
        identity_kind = next((c.get("identity_kind","") for c in sections.get("columns",[])
                              if f'{c["schema"]}.{c["relation"]}.{c["name"]}'==key),"")
        if identity_kind != identity_modes.get(key,""):
            identity_mismatches.append((key,identity_modes.get(key,""),identity_kind))
    report["column_properties"] = {
        "compared_columns":len(set(baseline_column_properties)&set(inventory_column_properties)),
        "data_type_mismatches":column_type_mismatches,
        "nullability_mismatches":column_nullability_mismatches,
        "default_presence_mismatches":column_default_mismatches,
        "identity_mode_mismatches":identity_mismatches,
        "generated_column_mismatches":column_generated_mismatches,
        "status":"PASS" if not any((column_type_mismatches,column_nullability_mismatches,column_default_mismatches,identity_mismatches,column_generated_mismatches)) else "FAIL"
    }

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
    for table,name in re.findall(
        rf'ALTER TABLE ONLY\s+({QUALIFIED})\s+ADD CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(?:PRIMARY KEY|UNIQUE)\b',
        sql,re.I
    ):
        schema = clean(table).split(".")[0]
        baseline_indexes.add(f"{schema}.{name}")
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

    inventory_extensions = {x["name"] for x in sections.get("extensions",[])}
    approved_extensions = {
        x["identity"] for x in registry.get("external_prerequisites",[])
        if x.get("family")=="extension" and x.get("classification")=="EXTENSION_OWNED"
           and x.get("approved") is True
    }
    report["extensions"] = {
        "inventory_count":len(inventory_extensions),
        "approved_external_prerequisites":sorted(approved_extensions),
        "unapproved_inventory_extensions":sorted(inventory_extensions-approved_extensions),
        "status":"PASS" if inventory_extensions <= approved_extensions else "FAIL",
        "limitation":"The selected application-schema pg_dump omits the built-in pg_catalog plpgsql extension; its provenance is checked against the explicit external-prerequisite registry, not falsely treated as a DDL dump match."
    }

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

    baseline_owner_map = {}
    owner_pattern = re.compile(
        rf'ALTER\s+(MATERIALIZED VIEW|TABLE|SEQUENCE|VIEW|INDEX|FUNCTION|PROCEDURE|TYPE|DOMAIN|SCHEMA)\s+({QUALIFIED}|{IDENT})(?:\([^;]*?\))?\s+OWNER TO\s+("?[\w]+"?)\s*;',
        re.I
    )
    for kind,obj,owner in owner_pattern.findall(sql):
        baseline_owner_map[clean(obj)] = clean(owner)

    inventory_owner_map = {}
    for x in sections.get("schema_acl",[]):
        inventory_owner_map[x["schema"]] = x.get("owner")
    for x in inv.get("objects",[]):
        if x.get("object_type") in ("table","partitioned_table","view","materialized_view"):
            inventory_owner_map[f'{x["schema"]}.{x["name"]}'] = x.get("owner")
    for x in sections.get("routines",[]):
        inventory_owner_map[f'{x["schema"]}.{x["name"]}({x["identity_arguments"]})'] = x.get("owner")
    for x in sections.get("types",[]):
        inventory_owner_map[f'{x["schema"]}.{x["name"]}'] = x.get("owner")
    owner_missing = sorted(set(inventory_owner_map)-set(baseline_owner_map))
    owner_extra = sorted(set(baseline_owner_map)-set(inventory_owner_map))
    owner_mismatches = sorted(
        (key,inventory_owner_map[key],baseline_owner_map[key])
        for key in set(inventory_owner_map)&set(baseline_owner_map)
        if inventory_owner_map[key] != baseline_owner_map[key]
    )
    report["ownership"] = {
        "baseline_owner_records":len(baseline_owner_map),
        "inventory_owner_records":len(inventory_owner_map),
        "missing_from_baseline":owner_missing,
        "missing_from_inventory":owner_extra,
        "mismatched_owners":owner_mismatches,
        "status":"PASS" if not owner_missing and not owner_extra and not owner_mismatches else "FAIL",
        "limitation":"Exact owners are compared for schemas, top-level relations, routines and explicit user-defined types; generated index/sequence/row-type ownership follows the owning relation or type and is validated by the provenance/owner preflight."
    }

    acl_inventory = {}
    def collect_acl(kind,identity,acl,owner):
        if not acl:
            return
        for item in acl.strip("{}").split(","):
            match = re.match(r"([^=]*)=([^/]*)/(.*)$",item)
            if not match:
                continue
            grantee = match.group(1) or "PUBLIC"
            if grantee == owner:
                continue
            privileges = set(match.group(2).replace("*",""))
            acl_inventory[(kind,identity,grantee)] = privileges

    for x in sections.get("schema_acl",[]):
        collect_acl("SCHEMA",x["schema"],x.get("acl"),x.get("owner"))
    relation_type = {
        (x["schema"],x["name"]):x.get("object_type")
        for x in inv.get("objects",[])
    }
    for x in sections.get("relation_acl",[]):
        typ = relation_type.get((x["schema"],x["relation"]))
        kind = {"table":"TABLE","partitioned_table":"TABLE","view":"TABLE",
                "materialized_view":"TABLE","sequence":"SEQUENCE","index":"INDEX"}.get(typ)
        if kind:
            collect_acl(kind,f'{x["schema"]}.{x["relation"]}',x.get("acl"),x.get("owner"))
    for x in sections.get("routine_acl",[]):
        collect_acl("FUNCTION",f'{x["schema"]}.{x["name"]}({x["identity_arguments"]})',x.get("acl"),x.get("owner"))
    for x in sections.get("type_acl",[]):
        collect_acl("TYPE",f'{x["schema"]}.{x["name"]}',x.get("acl"),x.get("owner"))
    for x in sections.get("column_acl",[]):
        collect_acl("COLUMN",f'{x["schema"]}.{x["relation"]}.{x["column_name"]}',x.get("acl"),None)

    privilege_letters = {
        "SELECT":"r","INSERT":"a","UPDATE":"w","DELETE":"d","TRUNCATE":"D",
        "REFERENCES":"x","TRIGGER":"t","EXECUTE":"X","USAGE":"U","CREATE":"C",
        "MAINTAIN":"m"
    }
    baseline_acl = {}
    baseline_revokes = []
    acl_pattern = re.compile(
        r'^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(SCHEMA|TABLE|SEQUENCE|FUNCTION|PROCEDURE|TYPE)\s+(.+?)\s+(TO|FROM)\s+([^;]+);',
        re.I|re.M
    )
    for action,priv_text,kind,obj,connector,grantees in acl_pattern.findall(sql):
        identity = clean(obj.strip())
        for grantee in (x.strip().replace('"',"") for x in grantees.split(",")):
            key = (kind.upper(),identity,grantee or "PUBLIC")
            if action.upper()=="REVOKE":
                baseline_revokes.append((key,priv_text.upper()))
                continue
            letters = set()
            for privilege in (x.strip().upper() for x in priv_text.split(",")):
                if privilege=="ALL":
                    letters.update("r a w d D x t m".split())
                    if kind.upper()=="SCHEMA":
                        letters.update(("U","C"))
                    elif kind.upper() in ("FUNCTION","PROCEDURE"):
                        letters.add("X")
                    elif kind.upper()=="TYPE":
                        letters.add("U")
                elif privilege in privilege_letters:
                    letters.add(privilege_letters[privilege])
            baseline_acl[key] = letters

    acl_missing = sorted(
        (key,sorted(value)) for key,value in acl_inventory.items()
        if baseline_acl.get(key,set()) != value
    )
    acl_extra = sorted(
        (key,sorted(value)) for key,value in baseline_acl.items()
        if acl_inventory.get(key,set()) != value
    )
    revoke_violations = sorted(
        (key,sorted(acl_inventory.get(key,set())))
        for key,_ in baseline_revokes if acl_inventory.get(key,set())
    )
    report["acl_metadata"] = {
        "baseline_grant_statements":len(baseline_acl),
        "baseline_revoke_statements":len(baseline_revokes),
        "inventory_non_owner_acl_entries":len(acl_inventory),
        "grant_mismatches":acl_missing,
        "unexpected_baseline_grants":acl_extra,
        "revoke_violations":revoke_violations,
        "status":"PASS" if not acl_missing and not acl_extra and not revoke_violations else "FAIL",
        "limitation":"Compares explicit non-owner grants and PUBLIC revocations for the disposable fixture. Default privilege semantics outside these statements remain separately inventoried."
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
