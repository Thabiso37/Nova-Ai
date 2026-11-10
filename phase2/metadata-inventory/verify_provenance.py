#!/usr/bin/env python3
"""Verify exact synthetic provenance paths and Git blob identities."""
import json,subprocess,sys
from pathlib import Path

root=Path(__file__).resolve().parents[2]
reg=json.loads((Path(__file__).resolve().parent/"provenance_registry.json").read_text())
bad=[]
history=reg.get("migration_history",[])
ids=[x.get("migration_id") for x in history]
if len(ids)!=len(set(ids)) or any(not x for x in ids):
    bad.append("duplicate_or_missing_migration_id")
byid={x["migration_id"]:x for x in history if x.get("migration_id")}
path_hashes={}
verified=0

def git_output(args):
    return subprocess.check_output(args,text=True,stderr=subprocess.DEVNULL).strip()

for item in history:
    kind=item.get("evidence_kind","").lower()
    if "synthetic" not in kind:
        continue
    path=item.get("path","")
    if not path or path.startswith("/") or ".." in Path(path).parts:
        bad.append("unsafe_migration_path")
        continue
    expected=item.get("git_blob_sha")
    if not expected or len(expected)!=40:
        bad.append("missing_migration_blob_identity:"+path)
        continue
    prior=path_hashes.setdefault(path,expected)
    if prior!=expected:
        bad.append("ambiguous_migration_path_hash:"+path)
        continue
    target=root/path
    if not target.is_file():
        bad.append("missing_migration_file:"+path)
        continue
    tracked=subprocess.run(["git","ls-files","--error-unmatch","--",path],
                           cwd=root,capture_output=True,text=True)
    if tracked.returncode:
        bad.append("untracked_migration_file:"+path)
        continue
    try:
        worktree_blob=git_output(["git","hash-object","--",str(target)])
        commit_blob=git_output(["git","rev-parse","HEAD:"+path])
    except subprocess.CalledProcessError:
        bad.append("migration_git_identity_unavailable:"+path)
        continue
    if worktree_blob!=expected or commit_blob!=expected:
        bad.append("changed_migration_file:"+path)
    else:
        verified+=1

objects=reg.get("objects",[])
keys=[str(x.get("family"))+"|"+str(x.get("identity")) for x in objects]
if len(keys)!=len(set(keys)):
    bad.append("duplicate_object_identity")
for item in objects:
    if not item.get("family") or not item.get("identity"):
        bad.append("incomplete_object_identity")
        continue
    mid=item.get("migration_id")
    migration=byid.get(mid)
    if not migration:
        bad.append("missing_migration_reference:"+str(mid))
        continue
    if "synthetic" in migration.get("evidence_kind","").lower():
        if item.get("evidence_path")!=migration.get("path"):
            bad.append("missing_or_mismatched_object_evidence_path:"+str(item.get("identity")))
        if item.get("evidence_blob_sha")!=migration.get("git_blob_sha"):
            bad.append("missing_or_mismatched_object_evidence_hash:"+str(item.get("identity")))

external=reg.get("external_prerequisites",[])
ek=[str(x.get("family"))+"|"+str(x.get("identity")) for x in external]
if len(ek)!=len(set(ek)):
    bad.append("duplicate_external_prerequisite")
for item in external:
    mid=item.get("evidence_migration_id")
    if item.get("approved") is True and mid not in byid:
        bad.append("missing_external_migration_reference:"+str(mid))

exclusions=reg.get("approved_exclusions",[])
exkeys=[str(x.get("identity_prefix")) for x in exclusions]
if len(exkeys)!=len(set(exkeys)):
    bad.append("duplicate_or_ambiguous_exclusion_identity")

out={
 "status":"FAIL" if bad else "PASS",
 "scope":reg.get("scope"),
 "migration_files_verified":verified,
 "synthetic_migration_paths":sorted(path_hashes),
 "objects_checked":len(objects),
 "external_prerequisites_checked":len(external),
 "approved_exclusions_checked":len(exclusions),
 "violations":bad,
 "limitation":"Synthetic fixture provenance only; PostgreSQL built-in and extension prerequisites are version-pinned environment evidence, not NOVAAI production migration provenance."
}
print(json.dumps(out,sort_keys=True))
if bad:
    sys.exit(1)
