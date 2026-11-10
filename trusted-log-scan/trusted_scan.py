#!/usr/bin/env python3
"""Trusted, fail-closed Phase 2 source-log scanner. Logs are data, never commands."""
import hashlib, json, os, pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path.cwd()
EVIDENCE = ROOT / "trusted-evidence"
RAW = EVIDENCE / "raw-source-job-logs.txt"
REPO = os.environ["GITHUB_REPOSITORY"]
BRANCH = "feature/metadata-only-inventory-prototype"
WORKFLOW_ID = 411977040
WORKFLOW_NAME = "Phase 2 Metadata Inventory Prototype"
WORKFLOW_PATH = ".github/workflows/phase2-metadata-inventory.yml"
SCANNER_SHA = "294fa19fac21b5467b9cf2eb0acb428678395575"
HASHES = {
    "scan_sensitive.py": "806789ebbe64e39af537415718b6b142d9f94e383def200390e6cf075e4ac238",
    "secret_patterns.py": "bc76e0af5047a093c093710621f85f1d89f3cb07a8622c6da51dc7088a470233",
}
PAIRS = {
    ("42640933100", "41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"),
    ("42652510694", "294fa19fac21b5467b9cf2eb0acb428678395575"),
}

def run(args, *, capture=True):
    p = subprocess.run(args, text=True, stdout=subprocess.PIPE if capture else None,
                       stderr=subprocess.PIPE if capture else None, check=False)
    if p.returncode:
        raise RuntimeError("command_failed:" + pathlib.Path(args[0]).name + ":" + str(p.returncode))
    return p.stdout if capture else ""

def gh_json(args):
    return json.loads(run(["gh", "api", *args]))

def write_json(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")

def main():
    EVIDENCE.mkdir(exist_ok=True)
    status = {"trusted_workflow_commit": os.environ.get("GITHUB_SHA", ""),
              "event": os.environ["EVENT_NAME"], "dispatch_actor": os.environ.get("DISPATCH_ACTOR", ""),
              "result": "FAIL", "rejected_conditions": []}
    try:
        event = status["event"]
        if event == "repository_dispatch":
            if status["dispatch_actor"] != "Thabiso37":
                raise ValueError("unauthorized_dispatch_actor")
            run_id = os.environ.get("DISPATCH_RUN_ID", "")
            source_sha = os.environ.get("DISPATCH_SOURCE_SHA", "")
            if (run_id, source_sha) not in PAIRS:
                raise ValueError("unapproved_historical_run_sha_pair")
            expected_attempt = 1
        elif event == "workflow_run":
            run_id = os.environ.get("EVENT_RUN_ID", "")
            source_sha = ""  # obtained from authenticated run metadata below
            expected_attempt = int(os.environ.get("EVENT_RUN_ATTEMPT", "0"))
            if not re.fullmatch(r"[0-9]+", run_id) or expected_attempt != 1:
                raise ValueError("invalid_or_unexpected_workflow_run_attempt")
        else:
            raise ValueError("unsupported_event")
        if not re.fullmatch(r"[0-9]+", run_id):
            raise ValueError("invalid_run_id")

        meta = gh_json([f"repos/{REPO}/actions/runs/{run_id}"])
        write_json("source-run-metadata.json", {k: meta.get(k) for k in
            ("id","workflow_id","name","path","head_branch","head_sha","event","status","conclusion","run_attempt")})
        if meta.get("id") != int(run_id): raise ValueError("run_id_mismatch")
        if meta.get("workflow_id") != WORKFLOW_ID: raise ValueError("workflow_id_mismatch")
        if meta.get("name") != WORKFLOW_NAME: raise ValueError("workflow_name_mismatch")
        if meta.get("path") not in (WORKFLOW_PATH, WORKFLOW_PATH + "@refs/heads/" + BRANCH):
            raise ValueError("workflow_path_mismatch")
        if meta.get("head_branch") != BRANCH: raise ValueError("source_branch_mismatch")
        if meta.get("event") != "push": raise ValueError("source_event_mismatch")
        if meta.get("status") != "completed" or meta.get("conclusion") != "success":
            raise ValueError("source_run_not_successful")
        if meta.get("run_attempt") != expected_attempt or expected_attempt != 1:
            raise ValueError("unexpected_run_attempt")
        source_sha = meta.get("head_sha", "")
        if event == "repository_dispatch" and (run_id, source_sha) not in PAIRS:
            raise ValueError("run_metadata_does_not_match_approved_pair")
        if event == "workflow_run" and not re.fullmatch(r"[0-9a-f]{40}", source_sha):
            raise ValueError("invalid_source_commit_sha")
        status.update(source_run_id=run_id, source_sha=source_sha)

        # Fetch all pages, preserve JSON records, and independently compare total_count.
        pages = run(["gh","api","--paginate","--jq",".jobs[]",
                     f"repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100"]).splitlines()
        jobs = [json.loads(line) for line in pages if line.strip()]
        first = gh_json([f"repos/{REPO}/actions/runs/{run_id}/jobs?per_page=1"])
        if len(jobs) != first.get("total_count") or not jobs:
            raise ValueError("incomplete_or_empty_job_pagination")
        write_json("source-run-jobs-sanitized.json", [
            {k:j.get(k) for k in ("id","name","status","conclusion","started_at","completed_at")} for j in jobs])
        matches = [j for j in jobs if j.get("name") == "disposable-postgres-17"]
        if len(matches) != 1: raise ValueError("missing_or_duplicate_disposable_postgres_job")
        job = matches[0]
        if job.get("status") != "completed" or job.get("conclusion") != "success":
            raise ValueError("source_job_not_successful")
        status["selected_job_id"] = job["id"]

        # gh writes untrusted logs to a file. Never source, eval, or execute their contents.
        log_result = subprocess.run(["gh","run","view",run_id,"--repo",REPO,"--job",str(job["id"]),"--log"],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        (EVIDENCE / "log-retrieval-exit-status.txt").write_text(str(log_result.returncode)+"\n")
        if log_result.returncode != 0 or not log_result.stdout:
            raise ValueError("log_retrieval_failed_or_empty")
        RAW.write_bytes(log_result.stdout)
        status["log_sha256"] = hashlib.sha256(log_result.stdout).hexdigest()
        status["log_bytes"] = len(log_result.stdout)

        # Verify source commit and approved content hashes before using scanner code.
        src = ROOT / "approved-scanner-source"
        actual_sha = run(["git","-C",str(src),"rev-parse","HEAD"]).strip()
        if actual_sha != SCANNER_SHA: raise ValueError("scanner_source_commit_mismatch")
        isolated = ROOT / "isolated-scanner"
        if isolated.exists(): shutil.rmtree(isolated)
        run(["git","clone","--no-hardlinks","--no-local",str(src),str(isolated)])
        run(["git","-C",str(isolated),"checkout","--detach",SCANNER_SHA])
        if run(["git","-C",str(isolated),"rev-parse","HEAD"]).strip() != SCANNER_SHA:
            raise ValueError("isolated_scanner_commit_mismatch")
        common = pathlib.Path(run(["git","-C",str(isolated),"rev-parse","--git-common-dir"]).strip())
        common = (isolated/common).resolve() if not common.is_absolute() else common.resolve()
        if not common.is_relative_to((isolated/".git").resolve()):
            raise ValueError("shared_git_metadata_detected")
        if (isolated/".git").is_symlink() or (isolated/".git/objects/info/alternates").exists():
            raise ValueError("git_symlink_or_alternates_detected")
        symlinks = [str(p) for p in isolated.rglob("*") if p.is_symlink()]
        if symlinks: raise ValueError("scanner_checkout_symlinks_detected")
        run(["git","-C",str(isolated),"remote","remove","origin"])
        if run(["git","-C",str(isolated),"remote"]).strip(): raise ValueError("scanner_remote_not_removed")
        hash_records = {}
        for filename, expected in HASHES.items():
            file = isolated/"phase2/metadata-inventory"/filename
            actual = hashlib.sha256(file.read_bytes()).hexdigest()
            hash_records[filename] = {"sha256":actual,"expected":expected,"match":actual==expected}
            if actual != expected: raise ValueError("scanner_checksum_mismatch:"+filename)
        write_json("scanner-integrity.json", {"commit":actual_sha,"files":hash_records,
                                                "isolated_clone":True,"symlinks":[],"alternates":False,
                                                "remote_removed":True})
        scan = subprocess.run([sys.executable,str(isolated/"phase2/metadata-inventory/scan_sensitive.py"),str(RAW)],
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,check=False)
        (EVIDENCE/"scanner-output.txt").write_text(scan.stdout[:2000])
        if scan.stderr: (EVIDENCE/"scanner-stderr-status.txt").write_text("nonempty_stderr\n")
        if scan.returncode != 0: raise ValueError("scanner_nonzero_exit")
        if "SCAN PASS" not in scan.stdout: raise ValueError("scanner_did_not_report_pass")
        status.update(scanner_exit_code=scan.returncode, scan_result="PASS", result="PASS")
    except Exception as exc:
        status["rejected_conditions"].append(str(exc)[:240])
        (EVIDENCE/"failure-reason.txt").write_text(str(exc)[:240]+"\n")
        raise
    finally:
        status["raw_logs_uploaded"] = False
        status["raw_logs_local_only"] = RAW.exists()
        write_json("summary.json", status)

if __name__ == "__main__":
    main()
