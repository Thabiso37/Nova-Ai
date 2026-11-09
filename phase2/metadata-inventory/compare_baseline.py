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
    if len(sys.argv) not in (3,4,5,6):
        raise SystemExit("usage: compare_baseline.py inventory.json baseline.sql [unsupported.json] [provenance_registry.json] [baseline-dependencies.json]")
    inv = json.loads(Path(sys.argv[1]).read_text())
    sql = Path(sys.argv[2]).read_text(errors="replace")
    unsupported = json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv)>=4 else None
    registry = json.loads(Path(sys.argv[4]).read_text()) if len(sys.argv)>=5 else {"external_prerequisites":[]}
    baseline_dependencies = json.loads(Path(sys.argv[5]).read_text()) if len(sys.argv)==6 else None
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

    def canonical_sql(value):
        value = norm_sql(value)
        for _ in range(8):
            value = re.sub(r'\(\s*(-?\d+(?:\.\d+)?)\s*\)', r'\1', value)
            value = re.sub(r'\(\s*\(([^()]+)\)\s*\)', r'(\1)', value)
        return value

    def parse_column_definition(definition):
        type_match = re.match(
            r'(.+?)(?=\s+(?:NOT NULL|NULL|DEFAULT|GENERATED|COLLATE|CONSTRAINT)\b|$)',
            definition, re.I
        )
        data_type = norm_sql(type_match.group(1)) if type_match else ""
        not_null = bool(re.search(r'\bNOT NULL\b', definition, re.I))
        identity_kind = ""
        if re.search(r'\bGENERATED\s+BY\s+DEFAULT\s+AS\s+IDENTITY\b', definition, re.I):
            identity_kind = "d"
        elif re.search(r'\bGENERATED\s+ALWAYS\s+AS\s+IDENTITY\b', definition, re.I):
            identity_kind = "a"
        generated_kind = "s" if re.search(r'\bGENERATED\s+ALWAYS\s+AS\s*\(', definition, re.I) else ""
        default_match = re.search(
            r'\bDEFAULT\s+(.+?)(?=\s+(?:NOT NULL|NULL|GENERATED|COLLATE|CONSTRAINT)\b|$)',
            definition, re.I
        )
        default_value = norm_sql(default_match.group(1)) if default_match else None
        return (data_type, not_null, default_value, identity_kind, generated_kind)

    baseline_column_properties = {}
    for table, body in table_blocks.items():
        for line in body.splitlines():
            stripped = line.strip().rstrip(",")
            if not stripped or stripped.upper().startswith("CONSTRAINT "):
                continue
            match = re.match(r'"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(.+)$', stripped)
            if match:
                baseline_column_properties[f"{table}.{match.group(1)}"] = parse_column_definition(match.group(2))

    for table, column, mode in re.findall(
        rf'ALTER TABLE\s+({QUALIFIED})\s+ALTER COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD GENERATED\s+(ALWAYS|BY DEFAULT)\s+AS IDENTITY',
        sql, re.I
    ):
        key = f"{clean(table)}.{column}"
        if key in baseline_column_properties:
            current = list(baseline_column_properties[key])
            current[3] = "a" if mode.upper()=="ALWAYS" else "d"
            baseline_column_properties[key] = tuple(current)

    inventory_column_properties = {}
    for column in sections.get("columns", []):
        relation_key = f'{column["schema"]}.{column["relation"]}'
        if relation_key not in tables:
            continue
        key = f'{relation_key}.{column["name"]}'
        inventory_column_properties[key] = (
            norm_sql(column["data_type"]),
            bool(column["not_null"]),
            norm_sql(column["default_expression"]) if column["default_expression"] is not None else None,
            column["identity_kind"] or "",
            column["generated_kind"] or ""
        )
    column_property_mismatches = []
    for key in sorted(set(baseline_column_properties) | set(inventory_column_properties)):
        baseline_value = baseline_column_properties.get(key)
        inventory_value = inventory_column_properties.get(key)
        if baseline_value != inventory_value:
            column_property_mismatches.append({
                "column": key,
                "baseline": baseline_value,
                "inventory": inventory_value
            })
    report["column_properties"] = {
        "baseline_count": len(baseline_column_properties),
        "inventory_count": len(inventory_column_properties),
        "mismatches": column_property_mismatches,
        "status": "PASS" if not column_property_mismatches else "FAIL"
    }

    baseline_constraint_definitions = {}
    for table, name, definition in re.findall(
        rf'ALTER TABLE ONLY\s+({QUALIFIED})\s+ADD CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(.+?);',
        sql, re.I | re.S
    ):
        baseline_constraint_definitions[f"{clean(table)}.{name}"] = canonical_sql(definition)
    for match in re.finditer(rf'CREATE DOMAIN\s+({QUALIFIED})\s+AS\s+([\s\S]*?);', sql, re.I):
        domain, body = clean(match.group(1)), match.group(2)
        cm = re.search(r'\bCONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(CHECK\s*\([\s\S]*\))\s*$', body, re.I)
        if cm:
            baseline_constraint_definitions[f"{domain}.{cm.group(1)}"] = canonical_sql(cm.group(2))
    inventory_constraint_definitions = {
        f'{x["schema"]}.{x.get("relation") or x.get("domain_name")}.{x["name"]}': canonical_sql(x["definition"])
        for x in sections.get("constraints",[])
    }
    add_missing(report,"constraints",baseline_constraint_definitions,inventory_constraint_definitions)
    constraint_definition_mismatches = [
        {"constraint":key,"baseline":baseline_constraint_definitions.get(key),
         "inventory":inventory_constraint_definitions.get(key)}
        for key in sorted(set(baseline_constraint_definitions)|set(inventory_constraint_definitions))
        if baseline_constraint_definitions.get(key)!=inventory_constraint_definitions.get(key)
    ]
    report["constraint_definitions"] = {
        "compared_constraints":len(set(baseline_constraint_definitions)&set(inventory_constraint_definitions)),
        "mismatches":constraint_definition_mismatches,
        "status":"PASS" if not constraint_definition_mismatches else "FAIL"
    }

    baseline_index_definitions = {}
    for match in re.finditer(
        rf'CREATE\s+(?:UNIQUE\s+)?INDEX\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ON\s+(?:ONLY\s+)?({QUALIFIED})[\s\S]*?;',
        sql, re.I
    ):
        name, table = match.group(1), clean(match.group(2))
        baseline_index_definitions[f"{table.split('.')[0]}.{name}"] = canonical_sql(match.group(0).rstrip(";"))
    for table, name, kind, columns in re.findall(
        rf'ALTER TABLE ONLY\s+({QUALIFIED})\s+ADD CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(PRIMARY KEY|UNIQUE)\s*(\([^;]+\))',
        sql, re.I
    ):
        baseline_index_definitions[f"{clean(table).split('.')[0]}.{name}"] = canonical_sql(
            f"CREATE UNIQUE INDEX {name} ON {clean(table)} USING btree {columns}"
        )
    inventory_index_definitions = {
        f'{x["schema"]}.{x["index_name"]}': canonical_sql(x["definition"])
        for x in sections.get("indexes",[])
    }
    add_missing(report,"indexes",baseline_index_definitions,inventory_index_definitions)
    index_definition_mismatches = [
        {"index":key,"baseline":baseline_index_definitions.get(key),
         "inventory":inventory_index_definitions.get(key)}
        for key in sorted(set(baseline_index_definitions)|set(inventory_index_definitions))
        if baseline_index_definitions.get(key)!=inventory_index_definitions.get(key)
    ]
    report["index_definitions"] = {
        "compared_indexes":len(set(baseline_index_definitions)&set(inventory_index_definitions)),
        "mismatches":index_definition_mismatches,
        "status":"PASS" if not index_definition_mismatches else "FAIL"
    }

    baseline_routines = {
        clean(x) for x in re.findall(rf'CREATE\s+(?:OR REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+({QUALIFIED})\s*\(',sql,re.I)
    }
    inventory_routines = {f'{x["schema"]}.{x["name"]}' for x in sections.get("routines",[])}
    add_missing(report,"functions_and_procedures",baseline_routines,inventory_routines)

    inventory_extension_records = {
        (x["name"],x["version"],x["schema"],x["owner"])
        for x in sections.get("extensions",[])
    }
    baseline_extension_records = {
        (x["name"],x["version"],x["schema"],x["owner"])
        for x in (baseline_dependencies or {}).get("extensions",[])
    }
    approved_extensions = {
        x["identity"] for x in registry.get("external_prerequisites",[])
        if x.get("family")=="extension" and x.get("classification")=="EXTENSION_OWNED"
           and x.get("approved") is True
    }
    report["extensions"] = {
        "baseline_count":len(baseline_extension_records),
        "inventory_count":len(inventory_extension_records),
        "missing_from_inventory":sorted(baseline_extension_records-inventory_extension_records),
        "missing_from_baseline":sorted(inventory_extension_records-baseline_extension_records),
        "unapproved_inventory_extensions":sorted(x[0] for x in inventory_extension_records if x[0] not in approved_extensions),
        "status":"PASS" if baseline_dependencies is not None and baseline_extension_records==inventory_extension_records and all(x[0] in approved_extensions for x in inventory_extension_records) else "FAIL",
        "limitation":"Extension name, version, schema and owner are compared against the independent administrative catalogue snapshot; provenance approval is checked separately."
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

    baseline_trigger_definitions = {}
    for match in re.finditer(r'CREATE TRIGGER\s+"?([A-Za-z_][A-Za-z0-9_]*)"?[\s\S]*?;',sql,re.I):
        statement = match.group(0).rstrip(";")
        table_match = re.search(rf'\bON\s+({QUALIFIED})',statement,re.I)
        if table_match:
            key = f"{clean(table_match.group(1))}.{match.group(1)}"
            baseline_trigger_definitions[key] = canonical_sql(statement)
    inventory_trigger_definitions = {
        f'{x["schema"]}.{x["relation"]}.{x["name"]}': canonical_sql(x["definition"])
        for x in sections.get("triggers",[])
    }
    add_missing(report,"triggers",baseline_trigger_definitions,inventory_trigger_definitions)
    trigger_definition_mismatches = [
        {"trigger":key,"baseline":baseline_trigger_definitions.get(key),
         "inventory":inventory_trigger_definitions.get(key)}
        for key in sorted(set(baseline_trigger_definitions)|set(inventory_trigger_definitions))
        if baseline_trigger_definitions.get(key)!=inventory_trigger_definitions.get(key)
    ]
    report["trigger_definitions"] = {
        "compared_triggers":len(set(baseline_trigger_definitions)&set(inventory_trigger_definitions)),
        "mismatches":trigger_definition_mismatches,
        "status":"PASS" if not trigger_definition_mismatches else "FAIL"
    }

    baseline_policy_properties = {}
    command_codes = {"ALL":"*","SELECT":"r","INSERT":"a","UPDATE":"w","DELETE":"d"}
    for match in re.finditer(
        rf'CREATE POLICY\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ON\s+({QUALIFIED})([\s\S]*?);',
        sql,re.I
    ):
        name, table, tail = match.group(1), clean(match.group(2)), match.group(3)
        command_match = re.search(r'\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b',tail,re.I)
        role_match = re.search(r'\bTO\s+(.+?)(?=\s+(?:USING|WITH CHECK)\b|$)',tail,re.I|re.S)
        roles = sorted(x.strip().replace('"','') for x in role_match.group(1).split(",")) if role_match else ["PUBLIC"]
        using_match = re.search(r'\bUSING\s*\((.*?)\)(?=\s+WITH CHECK\b|$)',tail,re.I|re.S)
        check_match = re.search(r'\bWITH CHECK\s*\((.*?)\)\s*$',tail,re.I|re.S)
        baseline_policy_properties[f"{table}.{name}"] = (
            command_codes.get(command_match.group(1).upper(),"*") if command_match else "*",
            not bool(re.search(r'\bAS\s+RESTRICTIVE\b',tail,re.I)),
            roles,
            canonical_sql(using_match.group(1)) if using_match else None,
            canonical_sql(check_match.group(1)) if check_match else None
        )
    inventory_policy_properties = {
        f'{x["schema"]}.{x["relation"]}.{x["name"]}': (
            x["command"],bool(x["permissive"]),sorted(x["roles"]),
            canonical_sql(x["using_expression"]) if x["using_expression"] is not None else None,
            canonical_sql(x["check_expression"]) if x["check_expression"] is not None else None
        )
        for x in sections.get("policies",[])
    }
    add_missing(report,"rls_policies",baseline_policy_properties,inventory_policy_properties)
    policy_property_mismatches = [
        {"policy":key,"baseline":baseline_policy_properties.get(key),
         "inventory":inventory_policy_properties.get(key)}
        for key in sorted(set(baseline_policy_properties)|set(inventory_policy_properties))
        if baseline_policy_properties.get(key)!=inventory_policy_properties.get(key)
    ]
    report["rls_policy_properties"] = {
        "compared_policies":len(set(baseline_policy_properties)&set(inventory_policy_properties)),
        "mismatches":policy_property_mismatches,
        "status":"PASS" if not policy_property_mismatches else "FAIL"
    }

    baseline_partition_bounds = {}
    for parent,child,bound in re.findall(
        rf'ALTER TABLE ONLY\s+({QUALIFIED})\s+ATTACH PARTITION\s+({QUALIFIED})(?:\s+(FOR VALUES [^;]+))?;',
        sql,re.I
    ):
        baseline_partition_bounds[f"{clean(parent)}->{clean(child)}"] = canonical_sql(bound) if bound else None
    for parent,child in re.findall(
        rf'ALTER INDEX\s+({QUALIFIED})\s+ATTACH PARTITION\s+({QUALIFIED});',
        sql,re.I
    ):
        baseline_partition_bounds[f"{clean(parent)}->{clean(child)}"] = None
    inventory_partition_bounds = {
        f'{x["parent_schema"]}.{x["parent_name"]}->{x["child_schema"]}.{x["child_name"]}':
        canonical_sql(x["partition_bound"]) if x["partition_bound"] else None
        for x in sections.get("partitions",[])
    }
    add_missing(report,"partitions",baseline_partition_bounds,inventory_partition_bounds)
    partition_bound_mismatches = [
        {"partition":key,"baseline":baseline_partition_bounds.get(key),
         "inventory":inventory_partition_bounds.get(key)}
        for key in sorted(set(baseline_partition_bounds)|set(inventory_partition_bounds))
        if baseline_partition_bounds.get(key)!=inventory_partition_bounds.get(key)
    ]
    report["partition_bounds"] = {
        "compared_partitions":len(set(baseline_partition_bounds)&set(inventory_partition_bounds)),
        "mismatches":partition_bound_mismatches,
        "status":"PASS" if not partition_bound_mismatches else "FAIL"
    }

    baseline_rls_enabled = {
        clean(x) for x in re.findall(rf'ALTER TABLE\s+({QUALIFIED})\s+ENABLE ROW LEVEL SECURITY',sql,re.I)
    }
    baseline_rls_forced = {
        clean(x) for x in re.findall(rf'ALTER TABLE\s+({QUALIFIED})\s+FORCE ROW LEVEL SECURITY',sql,re.I)
    }
    inventory_rls_enabled = {
        f'{x["schema"]}.{x["name"]}' for x in inv.get("objects",[])
        if x.get("relrowsecurity")
    }
    inventory_rls_forced = {
        f'{x["schema"]}.{x["name"]}' for x in inv.get("objects",[])
        if x.get("relforcerowsecurity")
    }
    rls_mismatches = {
        "enabled_missing_from_inventory":sorted(baseline_rls_enabled-inventory_rls_enabled),
        "enabled_missing_from_baseline":sorted(inventory_rls_enabled-baseline_rls_enabled),
        "forced_missing_from_inventory":sorted(baseline_rls_forced-inventory_rls_forced),
        "forced_missing_from_baseline":sorted(inventory_rls_forced-baseline_rls_forced)
    }
    report["rls_configuration"] = {
        "baseline_enabled_count":len(baseline_rls_enabled),
        "inventory_enabled_count":len(inventory_rls_enabled),
        "baseline_forced_count":len(baseline_rls_forced),
        "inventory_forced_count":len(inventory_rls_forced),
        **rls_mismatches,
        "status":"PASS" if not any(rls_mismatches.values()) else "FAIL"
    }

    baseline_owner_map = {}
    owner_pattern = re.compile(
        rf'ALTER\s+(MATERIALIZED VIEW|TABLE|SEQUENCE|VIEW|INDEX|FUNCTION|PROCEDURE|TYPE|DOMAIN|SCHEMA)\s+({QUALIFIED}(?:\([^;]*?\))?|{IDENT})\s+OWNER TO\s+("?[\w]+"?)\s*;',
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
    baseline_default_privileges = re.findall(r'ALTER DEFAULT PRIVILEGES [^;]+;',sql,re.I)
    inventory_default_privileges = sections.get("default_privileges",[])
    default_privilege_status = "PASS" if not baseline_default_privileges and not inventory_default_privileges else "FAIL"
    report["default_privileges"] = {
        "baseline_statement_count":len(baseline_default_privileges),
        "inventory_record_count":len(inventory_default_privileges),
        "status":default_privilege_status,
        "limitation":"The disposable fixture currently requires an empty default-privilege set; any discovered default ACL fails closed pending a semantic parser."
    }

    report["acl_metadata"] = {
        "baseline_grant_statements":len(baseline_acl),
        "baseline_revoke_statements":len(baseline_revokes),
        "inventory_non_owner_acl_entries":len(acl_inventory),
        "grant_mismatches":acl_missing,
        "unexpected_baseline_grants":acl_extra,
        "revoke_violations":revoke_violations,
        "status":"PASS" if not acl_missing and not acl_extra and not revoke_violations and default_privilege_status=="PASS" else "FAIL",
        "limitation":"Compares explicit non-owner grants and PUBLIC revocations; non-empty default-privilege metadata fails closed rather than being silently skipped."
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
    inventory_edges = {
        (x["dependency_type"],x["dependent_type"],x.get("dependent_schema") or "",x["dependent_identity"],
         x["referenced_type"],x.get("referenced_schema") or "",x["referenced_identity"])
        for x in sections.get("dependencies",[])
    }
    baseline_edges = set()
    if baseline_dependencies is not None:
        baseline_edges = {
            (x["dependency_type"],x["dependent_type"],x.get("dependent_schema") or "",x["dependent_identity"],
             x["referenced_type"],x.get("referenced_schema") or "",x["referenced_identity"])
            for x in baseline_dependencies.get("edges",[])
        }
    missing_from_inventory_edges = sorted(baseline_edges-inventory_edges)
    missing_from_baseline_edges = sorted(inventory_edges-baseline_edges)
    dependency_snapshot_match = (
        baseline_dependencies is not None
        and baseline_dependencies.get("snapshot_id") == inv.get("snapshot",{}).get("snapshot_id")
    )
    report["dependency_snapshot"] = {
        "inventory_snapshot_id": inv.get("snapshot",{}).get("snapshot_id"),
        "administrative_snapshot_id": baseline_dependencies.get("snapshot_id") if baseline_dependencies else None,
        "status": "PASS" if dependency_snapshot_match else "FAIL"
    }
    report["dependencies"] = {
        "resolved_edges": len(inventory_edges),
        "administrative_baseline_edges":len(baseline_edges),
        "missing_from_inventory_edges":missing_from_inventory_edges,
        "missing_from_baseline_edges":missing_from_baseline_edges,
        "inventory_dependency_nodes": len(inventory_dependency_keys),
        "missing_inventory_nodes": missing_dependency_nodes,
        "cycle_count": len(sections.get("dependency_cycles",[])),
        "cycle_review_required": bool(sections.get("dependency_cycles")),
        "status": "PASS" if dependency_snapshot_match and not missing_from_inventory_edges and not missing_from_baseline_edges and not missing_dependency_nodes and not inv.get("completeness",{}).get("unresolved_dependencies") else "FAIL",
        "limitation": "Dependency edges are compared against the same imported exported snapshot. This remains a metadata graph comparison, not restoration equivalence."
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
