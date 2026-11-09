#!/usr/bin/env python3
"""Compare structured PostgreSQL catalogue snapshots and positive probe evidence."""
import json,sys
from pathlib import Path

if len(sys.argv) not in (4,5):
    raise SystemExit("usage: compare_catalogue.py inventory.json catalogue-baseline.json unsupported.json [unsupported-probe.json]")
inv=json.loads(Path(sys.argv[1]).read_text())
base=json.loads(Path(sys.argv[2]).read_text())
unsupported=json.loads(Path(sys.argv[3]).read_text())
probe=json.loads(Path(sys.argv[4]).read_text()) if len(sys.argv)==5 else None

REQUIRED_SECTIONS={
 "columns","sequences","constraints","indexes","routines","triggers","types","enums",
 "policies","partitions","extensions","relation_acl","default_privileges","schema_acl",
 "routine_acl","type_acl","column_acl"
}
EXPECTED_PROBES={
 "aggregate","collation","conversion","custom_cast","event_trigger","extended_statistics",
 "foreign_data_wrapper","foreign_server","foreign_table","large_object_metadata","operator",
 "operator_class","operator_family","publication","rule","security_label","shared_security_label",
 "subscription","text_search_configuration","text_search_dictionary","text_search_parser",
 "text_search_template","transform","unsupported_type_family","user_defined_language","user_mapping"
}
report={"status":"FAIL","checks":{},"unsupported_comparisons":[],"snapshot_match":False}
report["snapshot_match"]=inv.get("snapshot",{}).get("snapshot_id")==base.get("snapshot_id")
report["server_version_match"]=str(inv.get("snapshot",{}).get("version"))==str(base.get("version"))
if not report["server_version_match"]:
    report["unsupported_comparisons"].append("server_version_mismatch")
if not report["snapshot_match"]:
    report["unsupported_comparisons"].append("snapshot_id_mismatch")

inv_sections=set(inv.get("sections",{}))
base_sections=set(base.get("sections",{}))
missing_required=sorted(REQUIRED_SECTIONS-base_sections)
section_set_mismatch=sorted(inv_sections ^ base_sections)
report["checks"]["required_support_matrix_sections"]={
 "status":"PASS" if not missing_required and not section_set_mismatch else "FAIL",
 "missing_required_from_baseline":missing_required,
 "section_set_mismatch":section_set_mismatch
}

def clean_objects(items):
    return [{k:v for k,v in x.items() if k not in ("classification","support")} for x in items]

pairs={"objects":(clean_objects(inv.get("objects",[])),clean_objects(base.get("objects",[])))}
for name,values in base.get("sections",{}).items():
    pairs["section:"+name]=(inv.get("sections",{}).get(name),values)
for name,(left,right) in pairs.items():
    if left is None:
        report["checks"][name]={"status":"FAIL","reason":"inventory_section_missing"}
        continue
    l=json.dumps(left,sort_keys=True,default=str)
    r=json.dumps(right,sort_keys=True,default=str)
    report["checks"][name]={"status":"PASS" if l==r else "FAIL",
                            "inventory_count":len(left),"baseline_count":len(right)}

if unsupported.get("status")!="PASS":
    report["unsupported_comparisons"].append("unsupported_or_visibility_status_not_clean:"+str(unsupported.get("status")))
if unsupported.get("unverified_probe_families"):
    report["unsupported_comparisons"].append("unverified_positive_probe_families")

if probe is None:
    report["checks"]["positive_probe_evidence"]={"status":"FAIL","reason":"probe_report_not_supplied"}
else:
    found={x.get("family") for x in probe.get("unsupported_objects",[])}
    checks={x.get("catalogue_family"):x for x in probe.get("catalogue_visibility_checks",[])}
    missing=sorted(EXPECTED_PROBES-found)
    bad_visibility=sorted(x for x in EXPECTED_PROBES
                          if x not in checks or checks[x].get("status")!="PASS"
                          or not checks[x].get("query_executed"))
    valid=probe.get("status")=="FAIL" and not missing and not bad_visibility and not probe.get("catalogue_visibility_failures")
    report["checks"]["positive_probe_evidence"]={
      "status":"PASS" if valid else "FAIL",
      "expected_family_count":len(EXPECTED_PROBES),
      "discovered_family_count":len(EXPECTED_PROBES & found),
      "missing_families":missing,
      "visibility_failures":bad_visibility
    }
    if not valid:
        report["unsupported_comparisons"].append("positive_probe_evidence_incomplete")

failed=[k for k,v in report["checks"].items() if v["status"]!="PASS"]
if failed:
    report["unsupported_comparisons"].append("catalogue_mismatches:"+",".join(failed))
report["status"]="PASS" if report["snapshot_match"] and not report["unsupported_comparisons"] else "FAIL"
report["limitation"]="Structured metadata comparison only. Not DDL reconstruction, restore validation, production provenance, or restoration equivalence."
print(json.dumps(report,sort_keys=True))
if report["status"]!="PASS":
    sys.exit(1)
