#!/usr/bin/env python3
"""Compare complete structured catalogue metadata; no pg_dump regex parser."""
import json,sys
from pathlib import Path
inv=json.loads(Path(sys.argv[1]).read_text());base=json.loads(Path(sys.argv[2]).read_text())
unsupported=json.loads(Path(sys.argv[3]).read_text())
report={"status":"FAIL","checks":{},"unsupported_comparisons":[],"snapshot_match":False}
report["snapshot_match"]=inv.get("snapshot",{}).get("snapshot_id")==base.get("snapshot_id")
report["server_version_match"]=str(inv.get("snapshot",{}).get("version"))==str(base.get("version"))
if not report["server_version_match"]:report["unsupported_comparisons"].append("server_version_mismatch")
if not report["snapshot_match"]:report["unsupported_comparisons"].append("snapshot_id_mismatch")
def clean_objects(items):
 out=[]
 for x in items:
  out.append({k:v for k,v in x.items() if k not in ("classification","support")})
 return out
pairs={"objects":(clean_objects(inv.get("objects",[])),clean_objects(base.get("objects",[])))}
for name,values in base.get("sections",{}).items():
 pairs["section:"+name]=(inv.get("sections",{}).get(name),values)
for name,(left,right) in pairs.items():
 if left is None:
  report["checks"][name]={"status":"FAIL","reason":"inventory_section_missing"};continue
 l=json.dumps(left,sort_keys=True,default=str);r=json.dumps(right,sort_keys=True,default=str)
 report["checks"][name]={"status":"PASS" if l==r else "FAIL","inventory_count":len(left),"baseline_count":len(right)}
if unsupported.get("status")!="PASS":
 report["unsupported_comparisons"].append("unsupported_or_visibility_status_not_clean:"+str(unsupported.get("status")))
if unsupported.get("unverified_probe_families"):
 report["unsupported_comparisons"].append("unverified_positive_probe_families")
failed=[k for k,v in report["checks"].items() if v["status"]!="PASS"]
if failed:report["unsupported_comparisons"].append("catalogue_mismatches:"+",".join(failed))
report["status"]="PASS" if report["snapshot_match"] and not report["unsupported_comparisons"] else "FAIL"
report["limitation"]="Structured metadata comparison only. Not DDL reconstruction, restore validation, production provenance, or restoration equivalence."
print(json.dumps(report,sort_keys=True))
if report["status"]!="PASS":sys.exit(1)
