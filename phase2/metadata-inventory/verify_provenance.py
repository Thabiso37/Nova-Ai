#!/usr/bin/env python3
"""Verify synthetic provenance entries against exact checked-out Git blob identities."""
import json,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
reg=json.loads((Path(__file__).resolve().parent/"provenance_registry.json").read_text())
bad=[];history=reg.get("migration_history",[]);ids=[x.get("migration_id") for x in history]
if len(ids)!=len(set(ids)) or any(not x for x in ids):bad.append("duplicate_or_missing_migration_id")
byid={x["migration_id"]:x for x in history if x.get("migration_id")}
verified=0
for item in history:
 if "synthetic" not in item.get("evidence_kind","").lower():continue
 path=item.get("path","")
 if not path or path.startswith("/") or ".." in Path(path).parts:bad.append("unsafe_migration_path");continue
 target=root/path
 if not target.is_file():bad.append("missing_migration_file:"+path);continue
 expected=item.get("git_blob_sha")
 if not expected or len(expected)!=40:bad.append("missing_migration_blob_identity:"+path);continue
 actual=subprocess.check_output(["git","hash-object",str(target)],text=True).strip()
 if actual!=expected:bad.append("changed_migration_file:"+path)
 else:verified+=1
objects=reg.get("objects",[]);keys=[str(x.get("family"))+"|"+str(x.get("identity")) for x in objects]
if len(keys)!=len(set(keys)):bad.append("duplicate_object_identity")
for x in objects:
 if not x.get("family") or not x.get("identity"):bad.append("incomplete_object_identity")
 mid=x.get("migration_id")
 if mid not in byid:bad.append("missing_migration_reference:"+str(mid))
 elif "synthetic" in byid[mid].get("evidence_kind","").lower() and x.get("evidence_path") not in (None,byid[mid].get("path")):bad.append("migration_path_mismatch:"+str(x.get("identity")))
ext=reg.get("external_prerequisites",[]);ek=[str(x.get("family"))+"|"+str(x.get("identity")) for x in ext]
if len(ek)!=len(set(ek)):bad.append("duplicate_external_prerequisite")
out={"status":"FAIL" if bad else "PASS","scope":reg.get("scope"),"migration_files_verified":verified,"objects_checked":len(objects),"external_prerequisites_checked":len(ext),"violations":bad,"limitation":"Synthetic fixture provenance only; no production migration provenance is established."}
print(json.dumps(out,sort_keys=True))
if bad:sys.exit(1)
