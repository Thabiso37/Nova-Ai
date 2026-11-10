import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from secret_patterns import PATTERNS
SCRIPT=(ROOT/"inventory.py").read_text()
FIXTURE=(ROOT/"fixtures"/"bootstrap.sql").read_text()
DETECTOR=(ROOT/"detect_unsupported.py").read_text()

class StaticSafetyTests(unittest.TestCase):
 def test_requires_explicit_dsn(self):
  self.assertIn("INVENTORY_DSN",SCRIPT)
 def test_repeatable_read_read_only(self):
  self.assertIn("REPEATABLE READ",SCRIPT);self.assertIn("readonly=True",SCRIPT)
 def test_never_queries_application_rows(self):
  self.assertNotIn("SELECT * FROM novaai_app.customers",SCRIPT)
  self.assertNotIn("SELECT * FROM novaai_app.sellers",SCRIPT)
 def test_canaries_are_synthetic(self):
  self.assertIn("CANARY_CUSTOMER_7f3c2a91",FIXTURE)
  self.assertIn("CANARY_SELLER_8b1d4e62",FIXTURE)
 def test_no_ddl_output(self):
  self.assertNotIn("CREATE TABLE",SCRIPT);self.assertNotIn("ALTER TABLE",SCRIPT)
 def test_runtime_denial_requires_permission_sqlstate(self):
  runtime=(ROOT/"runtime_security.py").read_text()
  self.assertIn('state == "42501"',runtime)
  self.assertNotIn('"25006"',runtime)
  self.assertIn("autocommit = True",runtime)
 def test_runtime_denials_verify_the_expected_privilege_boundary(self):
  runtime=(ROOT/"runtime_security.py").read_text()
  self.assertIn("def denied(name, sql, precondition_sql)",runtime)
  self.assertIn("intended privilege boundary was not independently confirmed",runtime)
  self.assertIn("function_signatures",runtime)
  self.assertIn("Missing explicit privilege precondition",runtime)
  self.assertIn("autocommit = True",runtime)
  self.assertIn('state == "42501"',runtime)
 def test_security_audit_search_path_and_large_object_api(self):
  audit=(ROOT/"security_audit.py").read_text()
  for term in ("current_setting('search_path')","pg_db_role_setting","p.prosecdef",
               "lo_truncate64","pg_shseclabel","pg_shdepend",
               "pg_get_function_identity_arguments","unsafe_configured_search_paths","writable_schemas"):
   self.assertIn(term,audit)
 def test_snapshot_coordinator_imports_exported_snapshot(self):
  self.assertIn("pg_export_snapshot",(ROOT/"snapshot_coordinator.py").read_text())
  self.assertIn("SET TRANSACTION SNAPSHOT",(ROOT/"snapshot_consistency_test.py").read_text())
 def test_provenance_hash_validation(self):
  verifier=(ROOT/"verify_provenance.py").read_text()
  self.assertIn("hash-object",verifier);self.assertIn("changed_migration_file",verifier)
  self.assertIn('"ls-files"',verifier);self.assertIn('"rev-parse"',verifier)
 def test_structured_baseline_compares_full_routine_signatures(self):
  base=(ROOT/"catalogue_baseline.py").read_text()
  compare=(ROOT/"compare_catalogue.py").read_text()
  self.assertIn("pg_get_function_identity_arguments",base)
  self.assertIn("pg_get_functiondef",base)
  self.assertIn("snapshot_id",compare)
  self.assertIn("REQUIRED_SECTIONS",compare)
  self.assertIn("allowed_inventory_only",compare)
  self.assertIn("unsupported_dependencies",compare)
  self.assertIn("inventory_completeness",compare)
 def test_routine_comparison_uses_full_structured_identity(self):
  compare=(ROOT/"compare_baseline.py").read_text()
  self.assertIn("catalogue_baseline",compare)
  self.assertIn("identity_arguments",compare)
  self.assertIn("structured PostgreSQL catalogue",compare)
  self.assertNotIn("baseline_routines = {",compare)
  self.assertNotIn("escaped = re.escape(f'{routine[\"schema\"]}.{routine[\"name\"]}')",compare)
 def test_comparator_rejects_mismatched_exported_snapshots(self):
  required={"columns","sequences","constraints","indexes","routines","triggers","types","enums",
            "policies","partitions","extensions","relation_acl","default_privileges","schema_acl",
            "routine_acl","type_acl","column_acl"}
  probes={"aggregate","collation","conversion","custom_cast","event_trigger","extended_statistics",
          "foreign_data_wrapper","foreign_server","foreign_table","large_object_metadata","operator",
          "operator_class","operator_family","publication","rule","security_label","shared_security_label",
          "subscription","text_search_configuration","text_search_dictionary","text_search_parser",
          "text_search_template","transform","unsupported_type_family","user_defined_language","user_mapping"}
  inv={"snapshot":{"snapshot_id":"old-exported-snapshot","version":"170011"},
       "objects":[],"sections":{x:[] for x in required},
       "completeness":{"status":"PASS","unclassified_objects":[],"unsupported_objects":[],
                       "unresolved_dependencies":[],"unsupported_dependency_types":[],"secret_findings":[]}}
  base={"snapshot_id":"different-exported-snapshot","version":"170011","objects":[],
        "sections":{x:[] for x in required}}
  unsupported={"status":"PASS","unsupported_objects":[],"catalogue_visibility_failures":[],
               "unverified_probe_families":[]}
  probe={"status":"FAIL","unsupported_objects":[{"family":x} for x in probes],
         "catalogue_visibility_failures":[],
         "catalogue_visibility_checks":[{"catalogue_family":x,"query_executed":True,"status":"PASS"} for x in probes]}
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp)
   files=[root/"inventory.json",root/"baseline.json",root/"unsupported.json",root/"probe.json"]
   for path,data in zip(files,[inv,base,unsupported,probe]):
    path.write_text(json.dumps(data))
   result=subprocess.run([sys.executable,str(ROOT/"compare_catalogue.py"),*[str(x) for x in files]],
                         capture_output=True,text=True)
  self.assertNotEqual(result.returncode,0)
  self.assertIn("snapshot_id_mismatch",result.stdout)
 def test_probe_cleanup_fails_closed_and_verifies_removal(self):
  cleanup=(ROOT/"fixtures"/"remove_unsupported_probes.sql").read_text()
  self.assertIn("LOAD '/tmp/phase2_dummy_seclabel.so'",cleanup)
  self.assertIn("DO $phase2$",cleanup)
  self.assertIn("object security-label probe was not removed",cleanup)
  self.assertIn("shared security-label probe was not removed",cleanup)
  self.assertIn("transform probe was not removed",cleanup)
  self.assertNotIn("pg_stat_file",cleanup)
 def test_catalogue_visibility_includes_shared_security_labels(self):
  self.assertIn("pg_shseclabel",DETECTOR)
  self.assertIn("shared_security_label",DETECTOR)
 def test_transform_and_security_label_positive_probe_families(self):
  probes=(ROOT/"fixtures"/"unsupported_probes.sql").read_text()
  self.assertIn("CREATE TRANSFORM FOR",probes);self.assertIn("SECURITY LABEL FOR phase2_dummy",probes)
  self.assertNotIn("INSERT INTO pg_catalog.pg_transform",probes)
  self.assertIn('"transform"',DETECTOR)
  provider=(ROOT/"fixtures"/"phase2_dummy_seclabel.c").read_text()
  workflow=(ROOT.parents[1]/".github"/"workflows"/"phase2-metadata-inventory.yml").read_text()
  self.assertIn("register_label_provider",provider)
  self.assertIn("Build disposable SECURITY LABEL provider",workflow)
  self.assertIn("phase2_dummy_seclabel.so",workflow)
  self.assertIn("CREATE TRANSFORM FOR",probes)
  self.assertIn("phase2_transform_from_sql",provider)
  self.assertIn("security-label-provider-probe.json",workflow)
  self.assertNotIn("SELECT label",workflow)
  assertion=(ROOT/"tests"/"assert_security_label_probe.py").read_text()
  self.assertIn("label_values_read",assertion)
 def test_shared_secret_scanning_policy(self):
  policy=(ROOT/"secret_patterns.py").read_text()
  scanner=(ROOT/"scan_sensitive.py").read_text()
  self.assertIn("azure_sas_signature",policy)
  self.assertIn("private_key",policy)
  self.assertIn("from secret_patterns import CANARIES, PATTERNS",scanner)
 def test_expanded_secret_patterns_compile_and_match(self):
  patterns=dict(PATTERNS)
  samples={
   "authorization_api_key_headers":"X-API-Key: ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
   "gcp_service_account_private_key":'"private_key":"-----BEGIN PRIVATE KEY-----"',
   "azure_storage_account_key":"AccountKey=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/==",
   "aws_secret_or_session_key":"aws_secret_access_key=ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd",
   "oci_credential_assignment":"tenancy=ocid1.tenancy.oc1..abcdefghijklmnopqrstuvwx",
   "pem_private_key_variants":"-----BEGIN OPENSSH PRIVATE KEY-----"
  }
  for name,sample in samples.items():
   with self.subTest(name=name):
    self.assertIn(name,patterns)
    self.assertIsNotNone(patterns[name].search(sample))
 def test_workflow_pins_both_postgres_clients_and_gates_artifact_upload(self):
  workflow=(ROOT.parents[1]/".github"/"workflows"/"phase2-metadata-inventory.yml").read_text()
  self.assertIn("postgres:17.11 pg_dump --version",workflow)
  self.assertIn("psql --version",workflow)
  self.assertIn("steps.scan_evidence.outcome == 'success'",workflow)
  self.assertIn("baseline-psql-client-version.txt",workflow)
  self.assertIn("baseline-pgdump-client-version.txt",workflow)
 def scanner_workflow(self):
  return (ROOT.parents[1]/".github"/"workflows"/"phase2-workflow-log-scan.yml").read_text()

 def run_shell(self, script, **env):
  return subprocess.run(["bash","-euo","pipefail","-c",script],capture_output=True,text=True,
                        env={**__import__("os").environ,**env})

 def target_selection_block(self):
  workflow=self.scanner_workflow()
  start=workflow.index("# BEGIN APPROVED_PAIR_SELECTOR")+len("# BEGIN APPROVED_PAIR_SELECTOR")
  end=workflow.index("# END APPROVED_PAIR_SELECTOR",start)
  return "\n".join(line[10:] if line.startswith("          ") else line for line in workflow[start:end].splitlines())

 def run_selector(self,event,run_id="",source_sha=""):
  with tempfile.TemporaryDirectory() as tmp:
   output=pathlib.Path(tmp)/"github-output.txt"
   output.write_text("")
   result=self.run_shell(self.target_selection_block(),EVENT_NAME=event,
                         DISPATCH_RUN_ID=run_id,DISPATCH_SOURCE_SHA=source_sha,
                         GITHUB_OUTPUT=str(output))
   values={}
   for line in output.read_text().splitlines():
    key,value=line.split("=",1);values[key]=value
   return result,values

 def test_push_always_selects_pair_b(self):
  result,values=self.run_selector("push","42640933100","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb")
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(values,{"target_run_id":"42652510694","target_source_sha":"294fa19fac21b5467b9cf2eb0acb428678395575"})

 def test_dispatch_accepts_both_exact_approved_pairs(self):
  pairs=[("42640933100","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"),
         ("42652510694","294fa19fac21b5467b9cf2eb0acb428678395575")]
  for run_id,sha in pairs:
   with self.subTest(run_id=run_id):
    result,values=self.run_selector("workflow_dispatch",run_id,sha)
    self.assertEqual(result.returncode,0,result.stderr)
    self.assertEqual(values,{"target_run_id":run_id,"target_source_sha":sha})

 def test_dispatch_rejects_crossed_pairs(self):
  pairs=[("42640933100","294fa19fac21b5467b9cf2eb0acb428678395575"),
         ("42652510694","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb")]
  for run_id,sha in pairs:
   with self.subTest(run_id=run_id):
    result,_=self.run_selector("workflow_dispatch",run_id,sha)
    self.assertNotEqual(result.returncode,0)

 def test_dispatch_rejects_malformed_unknown_and_missing_values(self):
  cases=[("4264093310x","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"),
         ("42640933100","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabB"),
         ("42640933100",""),("","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"),
         ("42640933101","41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb"),
         ("42640933100","not-a-sha")]
  for run_id,sha in cases:
   with self.subTest(run_id=run_id,sha=sha):
    result,_=self.run_selector("workflow_dispatch",run_id,sha)
    self.assertNotEqual(result.returncode,0)

 def test_selector_rejects_unsupported_events(self):
  result,_=self.run_selector("schedule","42652510694","294fa19fac21b5467b9cf2eb0acb428678395575")
  self.assertNotEqual(result.returncode,0)

 def test_dispatch_requires_both_inputs(self):
  workflow=self.scanner_workflow()
  self.assertIn("target_run_id:",workflow)
  self.assertIn("target_source_sha:",workflow)
  self.assertIn("inputs.target_run_id",workflow)
  self.assertIn("inputs.target_source_sha",workflow)

 def test_selector_contains_only_exact_approved_pairs(self):
  selector=self.target_selection_block()
  self.assertIn("42640933100:41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb",selector)
  self.assertIn("42652510694:294fa19fac21b5467b9cf2eb0acb428678395575",selector)
  self.assertEqual(selector.count("42640933100:"),1)
  self.assertEqual(selector.count("42652510694:"),1)

 def test_source_workflow_name_and_path_are_validated(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r'--arg name "\$APPROVED_WORKFLOW_NAME"')
  self.assertRegex(workflow,r'--arg path "\$APPROVED_WORKFLOW_PATH"')
  self.assertRegex(workflow,r'\.name == \$name')
  self.assertRegex(workflow,r'\.path == \$path')

 def test_source_branch_and_exact_commit_are_validated(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r'--arg branch "\$APPROVED_BRANCH"')
  self.assertRegex(workflow,r'--arg sha "\$target_source_sha"')
  self.assertRegex(workflow,r'\.head_branch == \$branch')
  self.assertRegex(workflow,r'\.head_sha == \$sha')

 def test_source_run_must_be_completed_successfully(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r'\.status == "completed"')
  self.assertRegex(workflow,r'\.conclusion == "success"')

 def test_job_pagination_is_exhaustive_and_count_checked(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r"gh api --paginate")
  self.assertRegex(workflow,r"actual_total=.*jq 'length'")
  self.assertRegex(workflow,r'\[\[ "\$actual_total" -eq "\$expected_total" \]\]')

 def test_exactly_one_expected_job_is_required(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r'\.name == "disposable-postgres-17"')
  self.assertRegex(workflow,r'\[\[ "\$matching_count" -eq 1 \]\]')

 def test_selected_job_must_be_completed_successfully(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r'\.status == "completed"')
  self.assertRegex(workflow,r'\.conclusion == "success"')
  self.assertIn('job_id="$(jq -r',workflow)

 def test_log_retrieval_uses_validated_source_run_and_job_identifiers(self):
  workflow=self.scanner_workflow()
  self.assertIn('gh run view "$target_run_id" --repo "$GITHUB_REPOSITORY" --job "$job_id" --log',workflow)
  self.assertIn('target_run_id="$TARGET_RUN_ID"',workflow)
  self.assertIn('target_run_id="$TARGET_RUN_ID"',workflow)

 def test_retrieval_nonempty_hash_and_scan_share_one_log_path(self):
  workflow=self.scanner_workflow()
  path="scan-evidence/phase2-job-logs.txt"
  self.assertIn(f'> {path}',workflow)
  self.assertIn(f'test -s {path}',workflow)
  self.assertIn(f'sha256sum {path}',workflow)
  self.assertIn(f'scan_sensitive.py {path}',workflow)

 def test_scanner_source_integrity_is_pinned_and_verified_before_retrieval(self):
  workflow=self.scanner_workflow()
  self.assertIn("806789ebbe64e39af537415718b6b142d9f94e383def200390e6cf075e4ac238",workflow)
  self.assertIn("bc76e0af5047a093c093710621f85f1d89f3cb07a8622c6da51dc7088a470233",workflow)
  self.assertIn("sha256sum --check --strict",workflow)
  self.assertLess(workflow.index("Verify pinned scanner source integrity"),
                  workflow.index("Initialize evidence and verify source run identity"))

 def test_raw_logs_are_excluded_from_uploaded_artifact(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r"uses: actions/upload-artifact@v4")
  self.assertIn("!scan-evidence/phase2-job-logs.txt",workflow)

 def test_scanner_failure_causes_final_gate_to_fail(self):
  workflow=self.scanner_workflow()
  start=workflow.index('          [[ "$RETRIEVAL_OUTCOME" == "success" ]]')
  gate=workflow[start:]
  result=self.run_shell(gate,RETRIEVAL_OUTCOME="success",SCAN_OUTCOME="failure",STATIC_TEST_OUTCOME="success",INTEGRITY_OUTCOME="success")
  self.assertNotEqual(result.returncode,0)
  passed=self.run_shell(gate,RETRIEVAL_OUTCOME="success",SCAN_OUTCOME="success",STATIC_TEST_OUTCOME="success",INTEGRITY_OUTCOME="success")
  self.assertEqual(passed.returncode,0,passed.stderr)

 def test_retrieval_or_identity_failure_skips_scanner_and_fails_gate(self):
  workflow=self.scanner_workflow()
  self.assertRegex(workflow,r"if: steps\.retrieve\.outcome == 'success'")
  self.assertIn('if [[ "${{ steps.retrieve.outcome }}" != "success" ]]',workflow)
  start=workflow.index('          [[ "$RETRIEVAL_OUTCOME" == "success" ]]')
  gate=workflow[start:]
  for outcome in ("failure","skipped"):
   with self.subTest(outcome=outcome):
    result=self.run_shell(gate,RETRIEVAL_OUTCOME=outcome,SCAN_OUTCOME="skipped",STATIC_TEST_OUTCOME="success",INTEGRITY_OUTCOME="success")
    self.assertNotEqual(result.returncode,0)

if __name__=="__main__":
 unittest.main()
