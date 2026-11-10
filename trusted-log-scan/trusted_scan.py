#!/usr/bin/env python3
"""Fail-closed trusted Phase 2 log scanner. Retrieved logs are inert data."""
from __future__ import annotations
import hashlib, json, os, pathlib, re, shutil, subprocess, sys, zipfile, io, tempfile, urllib.error, urllib.parse, urllib.request
from dataclasses import dataclass

BRANCH = "feature/metadata-only-inventory-prototype"
WORKFLOW_ID = 411977040
WORKFLOW_NAME = "Phase 2 Metadata Inventory Prototype"
WORKFLOW_PATH = ".github/workflows/phase2-metadata-inventory.yml"
SOURCE_REPOSITORY = "Thabiso37/Nova-Ai"
SCANNER_SHA = "294fa19fac21b5467b9cf2eb0acb428678395575"
HASHES = {
 "scan_sensitive.py":"806789ebbe64e39af537415718b6b142d9f94e383def200390e6cf075e4ac238",
 "secret_patterns.py":"bc76e0af5047a093c093710621f85f1d89f3cb07a8622c6da51dc7088a470233",
}
HISTORICAL_PAIRS = {
 ("42640933100","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"),
 ("42652510694","294fa19fac21b5467b9cf2eb0acb428678395575"),
}
# Future runs are NEVER eligible by workflow name/ID alone. Add a pair only
# through a reviewed change to this trusted default-branch file.
FUTURE_APPROVED_PAIRS: set[tuple[str,str]] = set()
ALLOWED_ACTOR = "Thabiso37"
TARGET_JOB = "disposable-postgres-17"

class Reject(ValueError): pass

def validate_trusted_context(github_ref, github_sha):
    if github_ref != "refs/heads/main": raise Reject("trusted_workflow_not_running_from_main")
    if not isinstance(github_sha,str) or not re.fullmatch(r"[0-9a-f]{40}",github_sha):
        raise Reject("invalid_trusted_workflow_commit")
    return github_sha

def validate_event(event_name, actor, payload, run_event=None):
    if event_name == "repository_dispatch":
        if actor != ALLOWED_ACTOR: raise Reject("unauthorized_dispatch_actor")
        run_id = str((payload or {}).get("target_run_id", ""))
        sha = str((payload or {}).get("target_source_sha", ""))
        if (run_id, sha) not in HISTORICAL_PAIRS: raise Reject("unapproved_historical_run_sha_pair")
        return "historical", run_id, sha, 1
    if event_name == "workflow_run":
        if not isinstance(run_event, dict): raise Reject("missing_workflow_run_event")
        run_id = str(run_event.get("id", ""))
        attempt = run_event.get("run_attempt")
        if not run_id.isdigit() or attempt != 1: raise Reject("invalid_or_unexpected_workflow_run_attempt")
        return "future", run_id, None, 1
    raise Reject("unsupported_event")

def validate_run_metadata(meta, run_id, mode, requested_sha=None, future_pairs=None):
    if not isinstance(meta, dict): raise Reject("invalid_run_metadata")
    checks = [
      (meta.get("id") == int(run_id), "run_id_mismatch"),
      (meta.get("workflow_id") == WORKFLOW_ID, "workflow_id_mismatch"),
      (meta.get("name") == WORKFLOW_NAME, "workflow_name_mismatch"),
      (meta.get("path") in (WORKFLOW_PATH, WORKFLOW_PATH+"@refs/heads/"+BRANCH), "workflow_path_mismatch"),
      (meta.get("head_branch") == BRANCH, "source_branch_mismatch"),
      (isinstance(meta.get("head_repository"),dict) and meta["head_repository"].get("full_name") == SOURCE_REPOSITORY, "source_repository_mismatch"),
      (meta.get("event") == "push", "source_event_mismatch"),
      (meta.get("status") == "completed" and meta.get("conclusion") == "success", "source_run_not_successful"),
      (meta.get("run_attempt") == 1, "unexpected_run_attempt"),
    ]
    for ok, reason in checks:
        if not ok: raise Reject(reason)
    sha = meta.get("head_sha")
    if not isinstance(sha,str) or not re.fullmatch(r"[0-9a-f]{40}",sha): raise Reject("invalid_source_commit_sha")
    pair=(str(run_id),sha)
    if mode == "historical":
        if pair not in HISTORICAL_PAIRS or sha != requested_sha: raise Reject("run_metadata_does_not_match_approved_pair")
    elif mode == "future":
        if pair not in (future_pairs if future_pairs is not None else FUTURE_APPROVED_PAIRS):
            raise Reject("future_run_pair_not_explicitly_approved")
    else: raise Reject("unknown_validation_mode")
    return sha

def validate_jobs(pages, total_count):
    if not isinstance(total_count,int) or total_count < 1: raise Reject("invalid_job_total_count")
    if not isinstance(pages,list) or len(pages) != total_count: raise Reject("incomplete_job_pagination")
    if any(not isinstance(j,dict) for j in pages): raise Reject("invalid_job_record")
    ids=[j.get("id") for j in pages]
    if any(not isinstance(i,int) for i in ids) or len(set(ids)) != len(ids): raise Reject("duplicate_or_invalid_job_ids")
    matches=[j for j in pages if j.get("name")==TARGET_JOB]
    if not matches: raise Reject("missing_target_job")
    if len(matches)!=1: raise Reject("duplicate_target_jobs")
    job=matches[0]
    if job.get("status")!="completed" or job.get("conclusion")!="success": raise Reject("target_job_not_successful")
    if not isinstance(job.get("id"),int): raise Reject("invalid_target_job_id")
    return job

def validate_log_bytes(data, *, max_bytes=25*1024*1024, content_type="text/plain", content_length=None):
    """Validate a bounded, complete UTF-8 plain-text job log."""
    if not isinstance(data,(bytes,bytearray)) or not data: raise Reject("empty_log")
    if len(data)>max_bytes: raise Reject("log_exceeds_size_limit")
    if content_length is not None:
        try: declared=int(content_length)
        except (TypeError,ValueError): raise Reject("invalid_log_content_length")
        if declared != len(data): raise Reject("truncated_or_inconsistent_log_response")
    if content_type.split(";",1)[0].strip().lower() != "text/plain": raise Reject("unexpected_log_content_type")
    try: text=data.decode("utf-8",errors="strict")
    except UnicodeDecodeError: raise Reject("malformed_log_encoding")
    if not text or not text.strip(): raise Reject("empty_log")
    if "\x00" in text: raise Reject("malformed_log_content")
    if any(ord(ch)<32 and ch not in "\n\r\t\f\x1b" for ch in text): raise Reject("malformed_log_content")
    return bytes(data)

class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow HTTPS redirects with a fresh request that never carries the API token."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed=urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise Reject("unsafe_log_redirect_target")
        return urllib.request.Request(newurl,headers={"Accept":"text/plain","User-Agent":"NOVAAI-F02-log-fetcher"},method="GET")

def fetch_job_log_text(repo, job_id, token, opener=None, *, max_bytes=25*1024*1024):
    """Fetch the job-level plain-text log; authenticate only to api.github.com."""
    if not isinstance(token,str) or not token.strip(): raise Reject("missing_log_api_token")
    url=f"https://api.github.com/repos/{repo}/actions/jobs/{job_id}/logs"
    req=urllib.request.Request(url,headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"NOVAAI-F02-trusted-scanner"},method="GET")
    client=opener or urllib.request.build_opener(SafeRedirectHandler())
    try:
        response=client.open(req,timeout=30)
        try:
            status=getattr(response,"status",None) or response.getcode()
            if status != 200: raise Reject("log_http_status_not_success")
            content_type=response.headers.get("Content-Type","")
            content_length=response.headers.get("Content-Length")
            data=response.read(max_bytes+1)
        finally: response.close()
    except Reject: raise
    except (urllib.error.HTTPError,urllib.error.URLError,http.client.HTTPException,TimeoutError,OSError) as exc:
        raise Reject("log_retrieval_http_failure:"+type(exc).__name__)
    return validate_log_bytes(data,max_bytes=max_bytes,content_type=content_type,content_length=content_length)

def validate_scanner_checkout(repo_dir, git_run, expected_sha=SCANNER_SHA, expected_hashes=None):
    expected_hashes=expected_hashes or HASHES
    actual=git_run(["-C",str(repo_dir),"rev-parse","HEAD"]).strip()
    if actual!=expected_sha: raise Reject("scanner_source_commit_mismatch")
    common=pathlib.Path(git_run(["-C",str(repo_dir),"rev-parse","--git-common-dir"]).strip())
    common=(repo_dir/common).resolve() if not common.is_absolute() else common.resolve()
    if not common.is_relative_to((repo_dir/".git").resolve()): raise Reject("shared_git_metadata_detected")
    if (repo_dir/".git").is_symlink() or (repo_dir/".git/objects/info/alternates").exists():
        raise Reject("git_symlink_or_alternates_detected")
    if any(p.is_symlink() for p in repo_dir.rglob("*")): raise Reject("scanner_checkout_symlinks_detected")
    remotes=git_run(["-C",str(repo_dir),"remote"]).strip()
    if remotes: raise Reject("scanner_remote_not_removed")
    records={}
    for name, expected in expected_hashes.items():
        path=repo_dir/"phase2/metadata-inventory"/name
        if not path.is_file(): raise Reject("scanner_file_missing:"+name)
        actual_hash=hashlib.sha256(path.read_bytes()).hexdigest()
        records[name]={"sha256":actual_hash,"expected":expected,"match":actual_hash==expected}
        if actual_hash!=expected: raise Reject("scanner_checksum_mismatch:"+name)
    return {"commit":actual,"files":records,"isolated_clone":True,"symlinks":[],"alternates":False,"remote_removed":True}

def run_command(args, *, cwd=None):
    p=subprocess.run(args,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    if p.returncode: raise Reject("command_failed:"+pathlib.Path(args[0]).name+":"+str(p.returncode))
    return p.stdout

def gh_json(args):
    return json.loads(run_command(["gh","api",*args]))

def fetch_all_jobs(repo, run_id, api=gh_json):
    data=api([f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100"])
    if not isinstance(data,dict) or not isinstance(data.get("jobs"),list) or not isinstance(data.get("total_count"),int):
        raise Reject("invalid_jobs_api_response")
    jobs=list(data["jobs"])
    # Use explicit page traversal, rather than trusting a jq stream whose page
    # boundaries/metadata are discarded.
    page=2
    while len(jobs)<data["total_count"]:
        nxt=api([f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100&page={page}"])
        if not isinstance(nxt,dict) or not isinstance(nxt.get("jobs"),list): raise Reject("job_pagination_request_failed")
        if nxt.get("total_count") != data["total_count"]: raise Reject("job_pagination_total_changed")
        if not nxt["jobs"]: raise Reject("incomplete_job_pagination")
        jobs.extend(nxt["jobs"]); page+=1
        if page>100: raise Reject("job_pagination_limit_exceeded")
    if len(jobs)!=data["total_count"]: raise Reject("incomplete_job_pagination")
    return jobs,data["total_count"]

def execute_scanner(scanner_path, raw_path, runner=subprocess.run):
    proc=runner([sys.executable,str(scanner_path),str(raw_path)],text=True,stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,check=False)
    if proc.returncode != 0: raise Reject("scanner_nonzero_exit")
    if "SCAN PASS" not in proc.stdout: raise Reject("scanner_did_not_report_pass")
    return {"returncode":proc.returncode,"stdout":proc.stdout,"stderr":proc.stderr}

def safe_artifact_manifest(evidence_dir, raw_path):
    raw=raw_path.resolve()
    manifest=[]
    for path in sorted(evidence_dir.rglob("*")):
        if path.is_symlink(): raise Reject("symlink_in_artifact_evidence")
        if path.is_dir(): continue
        if not path.is_file(): raise Reject("non_regular_artifact_file")
        if path.resolve()==raw: continue  # present on runner, deliberately omitted from artifact
        rel=path.relative_to(evidence_dir).as_posix()
        if rel not in {"summary.json","source-run-metadata.json","source-run-jobs-sanitized.json",
                       "scanner-integrity.json","log-retrieval-exit-status.txt","scanner-output.txt",
                       "scanner-stderr-status.txt","failure-reason.txt"}:
            raise Reject("unexpected_artifact_file:"+rel)
        manifest.append(rel)
    return manifest

def stage_sanitized_artifact(evidence_dir, raw_path, staging_dir):
    """Build and validate in a temp directory, then atomically publish."""
    manifest=safe_artifact_manifest(evidence_dir,raw_path)
    staging_dir=pathlib.Path(staging_dir)
    staging_dir.parent.mkdir(parents=True,exist_ok=True)
    temp_root=pathlib.Path(tempfile.mkdtemp(prefix=".f02-stage-",dir=staging_dir.parent))
    candidate=temp_root/"payload"
    try:
        candidate.mkdir()
        for rel in manifest:
            source=evidence_dir/rel; target=candidate/rel
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
        staged=set()
        for path in candidate.rglob("*"):
            if path.is_symlink(): raise Reject("symlink_in_staged_artifact")
            if path.is_file(): staged.add(path.relative_to(candidate).as_posix())
            elif not path.is_dir(): raise Reject("non_regular_staged_artifact")
        if staged != set(manifest): raise Reject("staged_artifact_manifest_mismatch")
        if set(safe_artifact_manifest(candidate,candidate/"raw-source-job-logs.txt")) != set(manifest):
            raise Reject("staged_artifact_manifest_mismatch")
        if staging_dir.is_symlink(): raise Reject("unsafe_staging_destination")
        if staging_dir.exists():
            if not staging_dir.is_dir(): raise Reject("unsafe_staging_destination")
            shutil.rmtree(staging_dir)
        os.replace(candidate,staging_dir)
        return sorted(staged)
    finally: shutil.rmtree(temp_root,ignore_errors=True)

def execute(adapter=None):
    """Orchestrate using injectable API/command adapters for deterministic behavioral tests."""
    adapter=adapter or RuntimeAdapter()
    root=pathlib.Path.cwd(); evidence=root/"trusted-evidence"; evidence.mkdir(exist_ok=True)
    raw=evidence/"raw-source-job-logs.txt"
    status={"trusted_workflow_commit":os.environ.get("GITHUB_SHA",""),
            "event":os.environ.get("EVENT_NAME",""),"dispatch_actor":os.environ.get("DISPATCH_ACTOR",""),
            "result":"FAIL","rejected_conditions":[],"raw_logs_uploaded":False}
    try:
        status["trusted_workflow_commit"]=validate_trusted_context(os.environ.get("GITHUB_REF",""),os.environ.get("GITHUB_SHA",""))
        mode,run_id,requested_sha,attempt=validate_event(status["event"],status["dispatch_actor"],
          {"target_run_id":os.environ.get("DISPATCH_RUN_ID",""),"target_source_sha":os.environ.get("DISPATCH_SOURCE_SHA","")},
          {"id":os.environ.get("EVENT_RUN_ID",""),"run_attempt":int(os.environ.get("EVENT_RUN_ATTEMPT","0"))})
        meta=adapter.run_metadata(run_id)
        sha=validate_run_metadata(meta,run_id,mode,requested_sha)
        status.update(source_run_id=run_id,source_sha=sha)
        jobs,total=adapter.jobs(run_id)
        job=validate_jobs(jobs,total); status["selected_job_id"]=job["id"]
        archive=adapter.logs(job["id"])
        log_data=validate_log_bytes(archive)
        raw.write_bytes(log_data)
        status.update(log_sha256=hashlib.sha256(log_data).hexdigest(),log_bytes=len(log_data),
                      log_retrieval="complete_plain_text_validated")
        source=root/"approved-scanner-source"
        actual=adapter.git(["-C",str(source),"rev-parse","HEAD"]).strip()
        if actual!=SCANNER_SHA: raise Reject("scanner_source_commit_mismatch")
        isolated=root/"isolated-scanner"
        if isolated.exists(): shutil.rmtree(isolated)
        adapter.clone(source,isolated,SCANNER_SHA)
        records=validate_scanner_checkout(isolated,adapter.git)
        (evidence/"scanner-integrity.json").write_text(json.dumps(records,sort_keys=True,indent=2)+"\n")
        scan=execute_scanner(isolated/"phase2/metadata-inventory/scan_sensitive.py",raw,adapter.scan_runner)

        (evidence/"scanner-output.txt").write_text(scan["stdout"][:2000])
        status.update(scanner_exit_code=0,scan_result="PASS",scanner_hashes=records["files"],result="PASS")
    except Exception as exc:
        reason=str(exc)[:240]
        status["rejected_conditions"].append(reason)
        (evidence/"failure-reason.txt").write_text(reason+"\n")
        raise
    finally:
        status["raw_logs_local_only"]=raw.exists()
        (evidence/"summary.json").write_text(json.dumps(status,sort_keys=True,indent=2)+"\n")
        safe_artifact_manifest(evidence,raw)

class RuntimeAdapter:
    def run_metadata(self,run_id):
        return gh_json([f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{run_id}"])
    def jobs(self,run_id):
        return fetch_all_jobs(os.environ["GITHUB_REPOSITORY"],run_id)
    def logs(self,job_id):
        return fetch_job_log_text(os.environ["GITHUB_REPOSITORY"],job_id,os.environ["GH_TOKEN"])
    def git(self,args): return run_command(args)
    def clone(self,source,dest,sha):
        run_command(["git","clone","--no-hardlinks","--no-local",str(source),str(dest)])
        run_command(["git","-C",str(dest),"checkout","--detach",sha])
        run_command(["git","-C",str(dest),"remote","remove","origin"])
    def scan_runner(self,args,**kwargs):
        return subprocess.run(args,**kwargs)

if __name__=="__main__":
    execute()
