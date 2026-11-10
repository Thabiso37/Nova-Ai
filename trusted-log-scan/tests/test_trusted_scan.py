import io, json, os, pathlib, tempfile, unittest, zipfile, hashlib
from unittest.mock import patch
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import trusted_scan as ts

GOOD_SHA="41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"
GOOD_META={"id":42640933100,"workflow_id":411977040,"name":ts.WORKFLOW_NAME,"path":ts.WORKFLOW_PATH,
 "head_branch":ts.BRANCH,"head_repository":{"full_name":"Thabiso37/Nova-Ai"},"head_sha":GOOD_SHA,"event":"push","status":"completed","conclusion":"success","run_attempt":1}
GOOD_JOB={"id":991,"name":ts.TARGET_JOB,"status":"completed","conclusion":"success"}
def archive(data=b"ordinary workflow log\n"):
 b=io.BytesIO()
 with zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED) as z:z.writestr("job.txt",data)
 return b.getvalue()

class ValidationBehavior(unittest.TestCase):
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
 def test_failed_log_retrieval_rejected(self):
  from unittest.mock import patch
  failed=type("Proc",(),{"returncode":1,"stdout":b"","stderr":b"API unavailable"})()
  with patch.object(ts.subprocess,"run",return_value=failed):
   with self.assertRaisesRegex(ts.Reject,"log_retrieval_failed"):
    ts.fetch_job_log_zip("owner/repo",991,"not-a-real-token")
 def test_empty_truncated_and_invalid_logs_rejected(self):
  for data in [b"",b"not a zip",archive(b"")[:-8]]:
   with self.subTest(length=len(data)),self.assertRaises(ts.Reject):ts.validate_log_bytes(data)
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
 def test_raw_log_never_in_artifact_manifest_and_unexpected_files_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   e=pathlib.Path(d)/"evidence";e.mkdir();raw=e/"raw-source-job-logs.txt";raw.write_text("SECRET")
   (e/"summary.json").write_text("{}")
   self.assertNotIn(raw.name,ts.safe_artifact_manifest(e,raw))
   (e/"unexpected.bin").write_bytes(b"x")
   with self.assertRaisesRegex(ts.Reject,"unexpected_artifact_file"):ts.safe_artifact_manifest(e,raw)
 def test_execute_failure_writes_fail_closed_evidence(self):
  class NeverCalled:
   def run_metadata(self,*a): raise AssertionError("must reject before API access")
  with tempfile.TemporaryDirectory() as d:
   env={"EVENT_NAME":"repository_dispatch","DISPATCH_ACTOR":"intruder","DISPATCH_RUN_ID":"42640933100",
        "DISPATCH_SOURCE_SHA":GOOD_SHA,"EVENT_RUN_ID":"","EVENT_RUN_ATTEMPT":"0"}
   with patch.dict(os.environ,env,clear=False),patch.object(ts.pathlib.Path,"cwd",return_value=pathlib.Path(d)):
    with self.assertRaisesRegex(ts.Reject,"unauthorized_dispatch_actor"):ts.execute(NeverCalled())
   summary=json.loads((pathlib.Path(d)/"trusted-evidence/summary.json").read_text())
   self.assertEqual(summary["result"],"FAIL")
   self.assertIn("unauthorized_dispatch_actor",summary["rejected_conditions"][0])
   self.assertFalse(summary["raw_logs_uploaded"])

 def test_untrusted_workflow_definition_is_not_executed(self):
  # Eligibility depends on a run/SHA allowlist; source workflow code/artifacts are never an input.
  self.assertEqual(ts.FUTURE_APPROVED_PAIRS,set())
  with self.assertRaisesRegex(ts.Reject,"future_run_pair_not_explicitly_approved"):
   ts.validate_run_metadata(dict(GOOD_META,id=88),"88","future")
 def test_scanner_checkout_rejects_shared_git_metadata(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/".git").mkdir();(p/"phase2/metadata-inventory").mkdir(parents=True)
   def git(args):
    if "--git-common-dir" in args:return "/tmp/shared.git"
    if "HEAD" in args:return ts.SCANNER_SHA
    return ""
   with self.assertRaisesRegex(ts.Reject,"shared_git_metadata_detected"):ts.validate_scanner_checkout(p,git)

if __name__=="__main__":unittest.main(verbosity=2)
