import json, os, pathlib, tempfile, unittest, hashlib, subprocess
from unittest.mock import patch
import sys, urllib.error, urllib.request, urllib.parse
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import trusted_scan as ts

GOOD_SHA="41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"
GOOD_META={"id":42640933100,"workflow_id":411977040,"name":ts.WORKFLOW_NAME,"path":ts.WORKFLOW_PATH,
 "head_branch":ts.BRANCH,"head_repository":{"full_name":"Thabiso37/Nova-Ai"},"head_sha":GOOD_SHA,"event":"push","status":"completed","conclusion":"success","run_attempt":1}
GOOD_JOB={"id":991,"name":ts.TARGET_JOB,"status":"completed","conclusion":"success"}
class ValidationBehavior(unittest.TestCase):
 def test_trusted_workflow_trigger_and_checkout_boundary(self):
  workflow=pathlib.Path(".github/workflows/phase2-trusted-workflow-log-scan.yml").read_text()
  self.assertIn("workflow_run:",workflow)
  self.assertIn("repository_dispatch:",workflow)
  self.assertNotIn("workflow_dispatch:",workflow)
  self.assertIn("ref: ${{ github.sha }}",workflow)
  self.assertIn("path: trusted-orchestrator-source",workflow)
  self.assertIn("ref: 294fa19fac21b5467b9cf2eb0acb428678395575",workflow)
  self.assertNotIn("actions/download-artifact",workflow)
  self.assertIn("actions: read",workflow)
  self.assertIn("contents: read",workflow)
  self.assertNotIn("contents: write",workflow)
 def test_trusted_execution_requires_main_default_branch_context(self):
  self.assertEqual(ts.validate_trusted_context("refs/heads/main","a"*40),"a"*40)
  with self.assertRaisesRegex(ts.Reject,"trusted_workflow_not_running_from_main"):
   ts.validate_trusted_context("refs/heads/feature/untrusted","a"*40)
  with self.assertRaisesRegex(ts.Reject,"invalid_trusted_workflow_commit"):
   ts.validate_trusted_context("refs/heads/main","not-a-sha")
 def test_historical_pair_accepts_only_exact_run_sha(self):
  self.assertEqual(ts.validate_event("repository_dispatch","Thabiso37",{"target_run_id":"42640933100","target_source_sha":GOOD_SHA})[:3],
                   ("historical","42640933100",GOOD_SHA))
  for pair in [("42640933100","294fa19fac21b5467b9cf2eb0acb428678395575"),("42640933101",GOOD_SHA),("999","0"*40)]:
   with self.subTest(pair=pair),self.assertRaises(ts.Reject):
    ts.validate_event("repository_dispatch","Thabiso37",dict(target_run_id=pair[0],target_source_sha=pair[1]))
 def test_invalid_dispatch_actor_rejected(self):
  with self.assertRaisesRegex(ts.Reject,"unauthorized_dispatch_actor"):
   ts.validate_event("repository_dispatch","intruder",{"target_run_id":"42640933100","target_source_sha":GOOD_SHA})
 def test_incorrect_source_run_id_rejected(self):
  m=dict(GOOD_META,id=2)
  with self.assertRaisesRegex(ts.Reject,"run_id_mismatch"):ts.validate_run_metadata(m,"42640933100","historical",GOOD_SHA)
 def test_incorrect_commit_sha_rejected(self):
  m=dict(GOOD_META,head_sha="0"*40)
  with self.assertRaisesRegex(ts.Reject,"run_metadata_does_not_match_approved_pair"):ts.validate_run_metadata(m,"42640933100","historical",GOOD_SHA)
 def test_wrong_workflow_id_name_and_path_rejected(self):
  for field,value,reason in [("workflow_id",1,"workflow_id_mismatch"),("name","lookalike","workflow_name_mismatch"),("path","evil.yml","workflow_path_mismatch")]:
   with self.subTest(field=field),self.assertRaisesRegex(ts.Reject,reason):
    ts.validate_run_metadata(dict(GOOD_META,**{field:value}),"42640933100","historical",GOOD_SHA)
 def test_incorrect_source_repository_rejected(self):
  with self.assertRaisesRegex(ts.Reject,"source_repository_mismatch"):
   ts.validate_run_metadata(dict(GOOD_META,head_repository={"full_name":"attacker/fork"}),"42640933100","historical",GOOD_SHA)
 def test_incorrect_source_branch_rejected(self):
  with self.assertRaisesRegex(ts.Reject,"source_branch_mismatch"):
   ts.validate_run_metadata(dict(GOOD_META,head_branch="main"),"42640933100","historical",GOOD_SHA)
 def test_unexpected_event_type_rejected(self):
  with self.assertRaisesRegex(ts.Reject,"unsupported_event"):ts.validate_event("workflow_dispatch","Thabiso37",{})
  with self.assertRaisesRegex(ts.Reject,"source_event_mismatch"):
   ts.validate_run_metadata(dict(GOOD_META,event="workflow_dispatch"),"42640933100","historical",GOOD_SHA)
 def test_incomplete_or_unsuccessful_workflow_rejected(self):
  for patch in [{"status":"in_progress"},{"conclusion":"failure"},{"conclusion":"cancelled"}]:
   with self.subTest(patch=patch),self.assertRaises(ts.Reject):
    ts.validate_run_metadata(dict(GOOD_META,**patch),"42640933100","historical",GOOD_SHA)
 def test_unexpected_run_attempt_rejected(self):
  with self.assertRaisesRegex(ts.Reject,"unexpected_run_attempt"):
   ts.validate_run_metadata(dict(GOOD_META,run_attempt=2),"42640933100","historical",GOOD_SHA)
  with self.assertRaises(ts.Reject):
   ts.validate_event("workflow_run","Thabiso37",{},{"id":"7","run_attempt":2})
 def test_future_run_requires_explicit_exact_pair_approval(self):
  event={"id":"77","run_attempt":1}
  mode,rid,_,_=ts.validate_event("workflow_run","Thabiso37",{},event)
  future=dict(GOOD_META,id=77)
  with self.assertRaisesRegex(ts.Reject,"future_run_pair_not_explicitly_approved"):
   ts.validate_run_metadata(future,rid,mode)
  self.assertEqual(ts.validate_run_metadata(future,rid,mode,future_pairs={("77",GOOD_SHA)}),GOOD_SHA)
 def test_missing_duplicate_and_failed_jobs_rejected(self):
  with self.assertRaisesRegex(ts.Reject,"duplicate_or_invalid_job_ids"):ts.validate_jobs([GOOD_JOB,dict(GOOD_JOB,name="other")],2)
  with self.assertRaisesRegex(ts.Reject,"missing_target_job"):ts.validate_jobs([{"id":1,"name":"other"}],1)
  with self.assertRaisesRegex(ts.Reject,"duplicate_target_jobs"):ts.validate_jobs([GOOD_JOB,dict(GOOD_JOB,id=992)],2)
  with self.assertRaisesRegex(ts.Reject,"target_job_not_successful"):
   ts.validate_jobs([dict(GOOD_JOB,conclusion="failure")],1)
 def test_incomplete_job_pagination_rejected(self):
  with self.assertRaisesRegex(ts.Reject,"incomplete_job_pagination"):ts.validate_jobs([GOOD_JOB],2)
  def api(args):
   if "page=2" in args[0]: return {"jobs":[],"total_count":2}
   return {"jobs":[GOOD_JOB],"total_count":2}
  with self.assertRaisesRegex(ts.Reject,"incomplete_job_pagination"):ts.fetch_all_jobs("owner/repo","1",api)
 def test_pagination_fetches_every_page(self):
  calls=[]
  def api(args):
   calls.append(args[0])
   if "page=2" in args[0]:return {"jobs":[dict(GOOD_JOB,id=992,name="other")],"total_count":2}
   return {"jobs":[GOOD_JOB],"total_count":2}
  jobs,total=ts.fetch_all_jobs("o/r","1",api)
  self.assertEqual((len(jobs),total),(2,2));self.assertEqual(len(calls),2)
 def test_successful_plain_text_log_and_safe_302_redirect(self):
  body=b"2026-11-09T15:04:37Z Runner started\n##[group]Build\nstep completed\n"
  class Response:
   status=200
   headers={"Content-Type":"text/plain; charset=utf-8","Content-Length":str(len(body))}
   def read(self,n): return body[:n]
   def close(self): pass
  class FakeOpener:
   def open(self,request,timeout):
    self.initial=request
    self.redirected=ts.SafeRedirectHandler().redirect_request(request,None,302,"Found",
      {"Location":"https://download.example/log.txt"},"https://download.example/log.txt")
    return Response()
  client=FakeOpener()
  result=ts.fetch_job_log_text("owner/repo",991,"SENSITIVE_GH_TOKEN",client)
  self.assertEqual(result,body)
  self.assertEqual(client.initial.full_url,"https://api.github.com/repos/owner/repo/actions/jobs/991/logs")
  self.assertIn("SENSITIVE_GH_TOKEN",client.initial.get_header("Authorization"))
  self.assertIsNone(client.redirected.get_header("Authorization"))
  self.assertEqual(urllib.parse.urlsplit(client.redirected.full_url).scheme,"https")
  self.assertEqual(hashlib.sha256(result).hexdigest(),hashlib.sha256(body).hexdigest())

 def test_plain_text_log_rejects_empty_oversized_malformed_and_truncated(self):
  cases=[(b"","text/plain",None,"empty_log"),
         (b"12345","text/plain",None,"log_exceeds_size_limit"),
         (b"\xff","text/plain",None,"malformed_log_encoding"),
         (b"hello","application/zip",None,"unexpected_log_content_type"),
         (b"hello","text/plain","9","truncated_or_inconsistent_log_response"),
         (b"\x00binary","text/plain",None,"malformed_log_content")]
  for data,ctype,length,reason in cases:
   with self.subTest(reason=reason),self.assertRaisesRegex(ts.Reject,reason):
    ts.validate_log_bytes(data,max_bytes=4 if reason=="log_exceeds_size_limit" else 100,
                          content_type=ctype,content_length=length)

 def test_log_http_failure_and_unsafe_redirect_rejected(self):
  class FailedOpener:
   def open(self,request,timeout):
    raise urllib.error.HTTPError(request.full_url,503,"Unavailable",{},None)
  with self.assertRaisesRegex(ts.Reject,"log_retrieval_http_failure"):
   ts.fetch_job_log_text("owner/repo",991,"TOKEN",FailedOpener())
  request=urllib.request.Request("https://api.github.com/logs",headers={"Authorization":"Bearer TOKEN"})
  with self.assertRaisesRegex(ts.Reject,"unsafe_log_redirect_target"):
   ts.SafeRedirectHandler().redirect_request(request,None,302,"Found",{},
      "http://evil.example/log")

 def test_approved_scanner_source_hashes_match_trusted_values(self):
  root=pathlib.Path("approved-scanner-source/phase2/metadata-inventory")
  self.assertTrue(root.is_dir())
  for name,expected in ts.HASHES.items():
   self.assertEqual(hashlib.sha256((root/name).read_bytes()).hexdigest(),expected)
 def test_scanner_checksum_mismatch_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/".git/objects/info").mkdir(parents=True);(p/"phase2/metadata-inventory").mkdir(parents=True)
   for name in ts.HASHES:(p/"phase2/metadata-inventory"/name).write_text("altered")
   def git(args):
    if "rev-parse" in args and "HEAD" in args:return ts.SCANNER_SHA
    if "--git-common-dir" in args:return ".git"
    return ""
   with self.assertRaisesRegex(ts.Reject,"scanner_checksum_mismatch"):ts.validate_scanner_checkout(p,git)
 def test_scanner_nonzero_exit_fails(self):
  from unittest.mock import patch
  failed=type("Proc",(),{"returncode":9,"stdout":"SCAN FAIL","stderr":"pattern found"})()
  with patch.object(ts.subprocess,"run",return_value=failed):
   with self.assertRaisesRegex(ts.Reject,"scanner_nonzero_exit"):
    ts.execute_scanner("scanner.py","source.log")
 def test_sensitive_canaries_pass_through_real_approved_scanner(self):
  # Exercise the pinned scanner source checked into this repo only if present in test environment.
  # The CI checkout includes the source in the commit tree under phase2/metadata-inventory.
  candidates=[pathlib.Path("approved-scanner-source/phase2/metadata-inventory/scan_sensitive.py")]
  scanner=next((p for p in candidates if p.exists()),None)
  self.assertIsNotNone(scanner,"approved scanner source must be made available to this integration test")
  canary=b"CANARY_CUSTOMER_7f3c2a91\nCANARY_SELLER_8b1d4e62\nCANARY_RLS_DISABLED_91aa73\n"
  with tempfile.TemporaryDirectory() as d:
   log=pathlib.Path(d)/"canary.log";log.write_bytes(canary)
   import subprocess,sys
   p=subprocess.run([sys.executable,str(scanner),str(log)],capture_output=True,text=True)
   self.assertNotEqual(p.returncode,0)
   self.assertIn("SCAN FAIL",p.stdout+p.stderr)
   self.assertIn("synthetic_canary",p.stdout+p.stderr)
 def test_staging_copies_only_allowlisted_evidence_and_excludes_raw_logs(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);e=root/"evidence";e.mkdir()
   raw=e/"raw-source-job-logs.txt";raw.write_text("PRIVATE_RAW_LOG")
   (e/"summary.json").write_text('{"result":"FAIL"}')
   (e/"failure-reason.txt").write_text("expected failure")
   staged=root/"upload"
   files=ts.stage_sanitized_artifact(e,raw,staged)
   self.assertEqual(set(files),{"summary.json","failure-reason.txt"})
   self.assertFalse((staged/raw.name).exists())
   self.assertNotIn(b"PRIVATE_RAW_LOG",b"".join(p.read_bytes() for p in staged.iterdir()))
 def test_symlink_evidence_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);e=root/"evidence";e.mkdir()
   outside=root/"outside.txt";outside.write_text("not evidence")
   (e/"summary.json").symlink_to(outside)
   with self.assertRaisesRegex(ts.Reject,"symlink_in_artifact_evidence"):
    ts.safe_artifact_manifest(e,e/"raw-source-job-logs.txt")
 def test_raw_log_never_in_artifact_manifest_and_unexpected_files_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   e=pathlib.Path(d)/"evidence";e.mkdir();raw=e/"raw-source-job-logs.txt";raw.write_text("SECRET")
   (e/"summary.json").write_text("{}")
   self.assertNotIn(raw.name,ts.safe_artifact_manifest(e,raw))
   (e/"unexpected.bin").write_bytes(b"x")
   with self.assertRaisesRegex(ts.Reject,"unexpected_artifact_file"):ts.safe_artifact_manifest(e,raw)
 def test_successful_execution_records_source_job_and_scanner_integrity(self):
  import types, shutil
  source_checkout=pathlib.Path.cwd()/"approved-scanner-source"
  class SuccessfulAdapter:
   def run_metadata(self,run_id): return GOOD_META
   def jobs(self,run_id): return [GOOD_JOB],1
   def logs(self,job_id): return b"2026-11-09T15:04:37Z clean workflow log\n"
   def git(self,args):
    if "rev-parse" in args and "HEAD" in args: return ts.SCANNER_SHA
    if "--git-common-dir" in args: return ".git"
    if "remote" in args: return ""
    raise AssertionError(args)
   def clone(self,source,dest,sha):
    dest.mkdir(parents=True);(dest/".git/objects/info").mkdir(parents=True)
    target=dest/"phase2/metadata-inventory";target.mkdir(parents=True)
    for name in ts.HASHES: shutil.copyfile(source_checkout/"phase2/metadata-inventory"/name,target/name)
   def scan_runner(self,args,**kwargs): return types.SimpleNamespace(returncode=0,stdout="SCAN PASS\n",stderr="")
  with tempfile.TemporaryDirectory() as d:
   env={"EVENT_NAME":"repository_dispatch","DISPATCH_ACTOR":"Thabiso37","DISPATCH_RUN_ID":"42640933100",
        "DISPATCH_SOURCE_SHA":GOOD_SHA,"EVENT_RUN_ID":"","EVENT_RUN_ATTEMPT":"0",
        "GITHUB_REF":"refs/heads/main","GITHUB_SHA":"a"*40}
   with patch.dict(os.environ,env,clear=False),patch.object(ts.pathlib.Path,"cwd",return_value=pathlib.Path(d)):
    ts.execute(SuccessfulAdapter())
   evidence=pathlib.Path(d)/"trusted-evidence"
   summary=json.loads((evidence/"summary.json").read_text())
   self.assertEqual(summary["result"],"PASS")
   self.assertEqual(summary["source_run_id"],"42640933100")
   self.assertEqual(summary["source_sha"],GOOD_SHA)
   self.assertEqual(summary["log_sha256"],hashlib.sha256(b"2026-11-09T15:04:37Z clean workflow log\n").hexdigest())
   self.assertEqual(summary["selected_job_id"],991)
   self.assertEqual(summary["scanner_hashes"],{k:{"sha256":v,"expected":v,"match":True} for k,v in ts.HASHES.items()})
   staged=pathlib.Path(d)/"staged"
   files=ts.stage_sanitized_artifact(evidence,evidence/"raw-source-job-logs.txt",staged)
   self.assertNotIn("raw-source-job-logs.txt",files)
 def test_execute_failure_writes_fail_closed_evidence(self):
  class NeverCalled:
   def run_metadata(self,*a): raise AssertionError("must reject before API access")
  with tempfile.TemporaryDirectory() as d:
   env={"EVENT_NAME":"repository_dispatch","DISPATCH_ACTOR":"intruder","DISPATCH_RUN_ID":"42640933100",
        "DISPATCH_SOURCE_SHA":GOOD_SHA,"EVENT_RUN_ID":"","EVENT_RUN_ATTEMPT":"0",
        "GITHUB_REF":"refs/heads/main","GITHUB_SHA":"a"*40}
   with patch.dict(os.environ,env,clear=False),patch.object(ts.pathlib.Path,"cwd",return_value=pathlib.Path(d)):
    with self.assertRaisesRegex(ts.Reject,"unauthorized_dispatch_actor"):ts.execute(NeverCalled())
   summary=json.loads((pathlib.Path(d)/"trusted-evidence/summary.json").read_text())
   self.assertEqual(summary["result"],"FAIL")
   self.assertIn("unauthorized_dispatch_actor",summary["rejected_conditions"][0])
   self.assertFalse(summary["raw_logs_uploaded"])
   cli_env=dict(os.environ,**env)
   cli_env["GITHUB_WORKSPACE"]=d
   result=subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve().parents[1]/"trusted_scan.py")],
                         cwd=d,env=cli_env,capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0,"scanner failure must propagate as a non-successful process exit")

 def test_untrusted_workflow_definition_is_not_executed(self):
  # Eligibility depends on an exact run/SHA allowlist; workflow text remains inert log data.
  self.assertEqual(ts.FUTURE_APPROVED_PAIRS,set())
  with self.assertRaisesRegex(ts.Reject,"future_run_pair_not_explicitly_approved"):
   ts.validate_run_metadata(dict(GOOD_META,id=88),"88","future")
  scanner=pathlib.Path("approved-scanner-source/phase2/metadata-inventory/scan_sensitive.py")
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);log=root/"candidate-workflow.log";sentinel=root/"executed"
   log.write_text("name: untrusted\njobs:\n  pwn:\n    steps:\n      - run: touch "+str(sentinel)+"\n")
   import subprocess,sys
   result=subprocess.run([sys.executable,str(scanner),str(log)],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
   self.assertFalse(sentinel.exists())
 def test_scanner_checkout_rejects_shared_git_metadata(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/".git").mkdir();(p/"phase2/metadata-inventory").mkdir(parents=True)
   def git(args):
    if "--git-common-dir" in args:return "/tmp/shared.git"
    if "HEAD" in args:return ts.SCANNER_SHA
    return ""
   with self.assertRaisesRegex(ts.Reject,"shared_git_metadata_detected"):ts.validate_scanner_checkout(p,git)

 
 def test_artifact_staging_failure_never_publishes_partial_directory(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);e=root/"evidence";e.mkdir()
   (e/"summary.json").write_text("{}")
   (e/"unexpected.txt").write_text("not allowed")
   staged=root/"upload"
   with self.assertRaisesRegex(ts.Reject,"unexpected_artifact_file"):
    ts.stage_sanitized_artifact(e,e/"raw-source-job-logs.txt",staged)
   self.assertFalse(staged.exists())
   self.assertEqual(list(root.glob(".f02-stage-*")),[])

 def test_artifact_copy_failure_does_not_publish_partial_directory(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);e=root/"evidence";e.mkdir()
   (e/"summary.json").write_text("{}")
   (e/"failure-reason.txt").write_text("failed")
   staged=root/"upload"
   with patch.object(ts.shutil,"copyfile",side_effect=OSError("simulated copy failure")):
    with self.assertRaises(OSError):
     ts.stage_sanitized_artifact(e,e/"raw-source-job-logs.txt",staged)
   self.assertFalse(staged.exists())
   self.assertEqual(list(root.glob(".f02-stage-*")),[])

 def test_artifact_staging_rejects_symlinked_directory(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);e=root/"evidence";e.mkdir()
   outside=root/"outside";outside.mkdir();(outside/"summary.json").write_text("{}")
   (e/"linked-dir").symlink_to(outside,target_is_directory=True)
   with self.assertRaisesRegex(ts.Reject,"symlink_in_artifact_evidence"):
    ts.stage_sanitized_artifact(e,e/"raw-source-job-logs.txt",root/"upload")

 def test_scanner_checkout_rejects_symlinks(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/".git/objects/info").mkdir(parents=True)
   (p/"phase2/metadata-inventory").mkdir(parents=True)
   (p/"escape").symlink_to(p/"phase2",target_is_directory=True)
   def git(args):
    if "HEAD" in args:return ts.SCANNER_SHA
    if "--git-common-dir" in args:return ".git"
    return ""
   with self.assertRaisesRegex(ts.Reject,"scanner_checkout_symlinks_detected"):
    ts.validate_scanner_checkout(p,git)

 def test_scanner_checkout_rejects_git_alternates(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/".git/objects/info").mkdir(parents=True)
   (p/".git/objects/info/alternates").write_text("/tmp/objects")
   (p/"phase2/metadata-inventory").mkdir(parents=True)
   def git(args):
    if "HEAD" in args:return ts.SCANNER_SHA
    if "--git-common-dir" in args:return ".git"
    return ""
   with self.assertRaisesRegex(ts.Reject,"git_symlink_or_alternates_detected"):
    ts.validate_scanner_checkout(p,git)

 def test_scanner_checkout_rejects_remaining_remote(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/".git/objects/info").mkdir(parents=True)
   (p/"phase2/metadata-inventory").mkdir(parents=True)
   def git(args):
    if "HEAD" in args:return ts.SCANNER_SHA
    if "--git-common-dir" in args:return ".git"
    if "remote" in args:return "origin"
    return ""
   with self.assertRaisesRegex(ts.Reject,"scanner_remote_not_removed"):
    ts.validate_scanner_checkout(p,git)

 def test_scanner_checkout_rejects_wrong_exact_commit(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/".git/objects/info").mkdir(parents=True)
   (p/"phase2/metadata-inventory").mkdir(parents=True)
   with self.assertRaisesRegex(ts.Reject,"scanner_source_commit_mismatch"):
    ts.validate_scanner_checkout(p,lambda args:"0"*40 if "HEAD" in args else ".git")

 def test_both_historical_pairs_and_both_crossed_pairs(self):
  pairs=sorted(ts.HISTORICAL_PAIRS)
  self.assertEqual(len(pairs),2)
  for rid,sha in pairs:
   mode,got_id,got_sha,_=ts.validate_event("repository_dispatch","Thabiso37",{"target_run_id":rid,"target_source_sha":sha})
   self.assertEqual((mode,got_id,got_sha),("historical",rid,sha))
   meta=dict(GOOD_META,id=int(rid),head_sha=sha)
   self.assertEqual(ts.validate_run_metadata(meta,rid,mode,sha),sha)
  for rid,sha in [(pairs[0][0],pairs[1][1]),(pairs[1][0],pairs[0][1])]:
   with self.subTest(crossed=(rid,sha)),self.assertRaisesRegex(ts.Reject,"unapproved_historical_run_sha_pair"):
    ts.validate_event("repository_dispatch","Thabiso37",{"target_run_id":rid,"target_source_sha":sha})

 def test_real_isolated_clone_of_approved_scanner_commit(self):
  source=pathlib.Path("approved-scanner-source").resolve()
  self.assertTrue((source/".git").exists())
  with tempfile.TemporaryDirectory() as d:
   dest=pathlib.Path(d)/"isolated"
   ts.RuntimeAdapter().clone(source,dest,ts.SCANNER_SHA)
   records=ts.validate_scanner_checkout(dest,lambda args:ts.run_command(["git",*args]))
   self.assertEqual(records["commit"],ts.SCANNER_SHA)
   self.assertTrue(records["isolated_clone"])
   self.assertFalse(records["alternates"])
   self.assertTrue(records["remote_removed"])

 def test_test_workflow_disables_persisted_checkout_credentials(self):
  workflow=pathlib.Path(".github/workflows/phase2-f02-tests.yml").read_text()
  self.assertEqual(workflow.count("actions/checkout@"),2)
  self.assertEqual(workflow.count("persist-credentials: false"),2)

if __name__=="__main__":unittest.main(verbosity=2)
