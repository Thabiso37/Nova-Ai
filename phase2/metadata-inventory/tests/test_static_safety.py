import json
import re
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
  return (ROOT.parents[1]/".github"/"workflows"/"phase2-trusted-workflow-log-scan.yml").read_text()

 def trusted_scanner(self):
  return (ROOT.parents[1]/"trusted-log-scan"/"trusted_scan.py").read_text()

 def source_workflow(self):
  return (ROOT.parents[1]/".github"/"workflows"/"phase2-metadata-inventory.yml").read_text()

 def test_dispatch_input_is_explicitly_captured(self):
  workflow=self.scanner_workflow()
  self.assertIn("EVENT_RUN_ID: ${{ github.event.workflow_run.id }}",workflow)
  self.assertIn("EVENT_RUN_ATTEMPT: ${{ github.event.workflow_run.run_attempt }}",workflow)

 def test_push_selects_only_the_approved_run(self):
  workflow=self.scanner_workflow()
  self.assertIn("workflow_run:",workflow)
  self.assertIn("branches: [main]",workflow)
  self.assertIn("ref: ${{ github.sha }}",workflow)
  self.assertIn("refs/heads/main",self.trusted_scanner())

 def test_dispatch_accepts_approved_numeric_run(self):
  scanner=self.trusted_scanner()
  self.assertIn('if event_name == "repository_dispatch":',scanner)
  self.assertIn("HISTORICAL_PAIRS",scanner)
  self.assertIn('if event_name == "workflow_run":',scanner)

 def test_dispatch_rejects_non_numeric_run_id(self):
  scanner=self.trusted_scanner()
  self.assertIn("not run_id.isdigit()",scanner)
  self.assertIn("int(run_id) < 1",scanner)

 def test_both_trigger_paths_reject_unapproved_run_ids(self):
  scanner=self.trusted_scanner()
  self.assertIn("unapproved_historical_run_sha_pair",scanner)
  self.assertIn("run_id_mismatch",scanner)
  self.assertIn("workflow_id_mismatch",scanner)

 def test_source_workflow_name_and_path_are_validated(self):
  scanner=self.trusted_scanner()
  self.assertIn('WORKFLOW_NAME = "Phase 2 Metadata Inventory Prototype"',scanner)
  self.assertIn('WORKFLOW_PATH = ".github/workflows/phase2-metadata-inventory.yml"',scanner)
  self.assertIn('meta.get("name") != WORKFLOW_NAME',scanner)
  self.assertIn('meta.get("path") != WORKFLOW_PATH',scanner)

 def test_source_branch_and_exact_commit_are_validated(self):
  scanner=self.trusted_scanner()
  self.assertIn('BRANCH = "main"',scanner)
  self.assertIn('meta.get("head_branch") != BRANCH',scanner)
  self.assertIn("invalid_source_commit_sha",scanner)
  self.assertIn("SOURCE_REPOSITORY_ID = 1436066881",scanner)

 def test_source_run_must_be_completed_successfully(self):
  scanner=self.trusted_scanner()
  self.assertIn('meta.get("status") != "completed"',scanner)
  self.assertIn('meta.get("conclusion") != "success"',scanner)
  self.assertIn('SOURCE_EVENT = "workflow_dispatch"',scanner)

 def test_job_pagination_is_exhaustive_and_count_checked(self):
  scanner=self.trusted_scanner()
  self.assertIn("per_page=100",scanner)
  self.assertIn("page={page}",scanner)
  self.assertIn("job_pagination_total_changed",scanner)
  self.assertIn("incomplete_job_pagination",scanner)

 def test_exactly_one_expected_job_is_required(self):
  scanner=self.trusted_scanner()
  self.assertIn('TARGET_JOB = "disposable-postgres-17"',scanner)
  self.assertIn('if len(matches)!=1: raise Reject("duplicate_target_jobs")',scanner)
  self.assertIn('raise Reject("missing_target_job")',scanner)

 def test_selected_job_must_be_completed_successfully(self):
  scanner=self.trusted_scanner()
  self.assertIn('job.get("status")!="completed"',scanner)
  self.assertIn('job.get("conclusion")!="success"',scanner)

 def test_log_retrieval_uses_validated_source_run_and_job_identifiers(self):
  scanner=self.trusted_scanner()
  self.assertIn('adapter.run_metadata(run_id)',scanner)
  self.assertIn('adapter.jobs(run_id)',scanner)
  self.assertIn('adapter.logs(job["id"])',scanner)
  self.assertLess(scanner.index('validate_run_metadata(meta,run_id,mode,requested_sha,event_attempt=attempt)'),
                  scanner.index('jobs,total=adapter.jobs(run_id)'))

 def test_retrieval_nonempty_hash_and_scan_share_one_log_path(self):
  scanner=self.trusted_scanner()
  self.assertIn('raw.write_bytes(log_data)',scanner)
  self.assertIn('hashlib.sha256(log_data).hexdigest()',scanner)
  self.assertIn('execute_scanner(isolated/"phase2/metadata-inventory/scan_sensitive.py",raw,adapter.scan_runner)',scanner)

 def test_raw_logs_are_excluded_from_uploaded_artifact(self):
  scanner=self.trusted_scanner()
  self.assertNotIn('"raw-source-job-logs.txt"',scanner[scanner.index("ALLOWED_EVIDENCE_FILES"):scanner.index("def safe_artifact_manifest")])
  self.assertIn("if path.resolve()==raw: continue",scanner)
  workflow=self.scanner_workflow()
  self.assertNotIn("actions/download-artifact",workflow)

 def test_scanner_failure_causes_final_gate_to_fail(self):
  scanner=self.trusted_scanner()
  self.assertIn('if proc.returncode != 0: raise Reject("scanner_nonzero_exit")',scanner)
  self.assertIn('if "SCAN PASS" not in proc.stdout: raise Reject("scanner_did_not_report_pass")',scanner)
  self.assertIn('status.update(scanner_exit_code=0,scan_result="PASS"',scanner)

 def test_retrieval_or_identity_failure_skips_scanner_and_fails_gate(self):
  scanner=self.trusted_scanner()
  metadata_check=scanner.index('validate_run_metadata(meta,run_id,mode,requested_sha,event_attempt=attempt)')
  jobs_call=scanner.index('jobs,total=adapter.jobs(run_id)')
  logs_call=scanner.index('archive=adapter.logs(job["id"])')
  scan_call=scanner.index('execute_scanner(isolated/"phase2/metadata-inventory/scan_sensitive.py",raw,adapter.scan_runner)')
  self.assertLess(metadata_check,jobs_call)
  self.assertLess(jobs_call,logs_call)
  self.assertLess(logs_call,scan_call)
  workflow=self.scanner_workflow()
  self.assertIn("actions: read",workflow)
  self.assertIn("contents: read",workflow)


 def _workflow_step(self, workflow, step_name):
  marker = "      - name: " + step_name + "\\n"
  start = workflow.find(marker)
  self.assertNotEqual(start, -1, "workflow step missing: " + step_name)
  end = workflow.find("\\n      - name:", start + len(marker))
  return workflow[start:] if end == -1 else workflow[start:end]

 def _workflow_condition(self, block):
  match = re.search(r"(?m)^        if: (.+)$", block)
  return match.group(1).strip() if match else "success()"

 def _condition_allows(self, expression, outcomes):
  expression = expression.replace(" ", "")
  if expression == "always()":
   return True
  if expression == "success()":
   return all(value == "success" for value in outcomes.values())
  for term in expression.split("&&"):
   if term == "always()":
    continue
   match = re.fullmatch(r"steps\\.([A-Za-z0-9_]+)\\.outcome=='success'", term)
   if not match:
    raise AssertionError("unsupported workflow condition in test harness: " + expression)
   if outcomes.get(match.group(1)) != "success":
    return False
  return True

 def _run_final_gate(self, scanner_outcome, staging_outcome):
  workflow = self.scanner_workflow()
  block = self._workflow_step(workflow, "Enforce scanner and evidence final gate")
  self.assertEqual(self._workflow_condition(block), "always()")
  run_marker = "        run: |\\n"
  offset = block.find(run_marker)
  self.assertNotEqual(offset, -1, "final gate must be an executable run block")
  script_lines = []
  for line in block[offset + len(run_marker):].splitlines():
   if line.startswith("          "):
    script_lines.append(line[10:])
   elif line.strip():
    break
  script = "\\n".join(script_lines) + "\\n"
  with tempfile.TemporaryDirectory() as tmp:
   script_path = pathlib.Path(tmp) / "final-gate.sh"
   script_path.write_text(script)
   env = dict(__import__("os").environ)
   env["SCANNER_OUTCOME"] = scanner_outcome
   env["STAGING_OUTCOME"] = staging_outcome
   return subprocess.run(["bash", "-e", "-o", "pipefail", str(script_path)],
                         env=env, capture_output=True, text=True)

 def test_workflow_final_gate_rejects_scanner_execution_failure(self):
  result = self._run_final_gate("failure", "success")
  self.assertNotEqual(result.returncode, 0)
  self.assertIn("scanner_step_not_successful", result.stderr)

 def test_workflow_final_gate_rejects_log_retrieval_failure(self):
  result = self._run_final_gate("failure", "success")
  self.assertNotEqual(result.returncode, 0)

 def test_workflow_final_gate_rejects_eligibility_failure(self):
  result = self._run_final_gate("failure", "success")
  self.assertNotEqual(result.returncode, 0)

 def test_workflow_final_gate_rejects_evidence_staging_failure(self):
  result = self._run_final_gate("success", "failure")
  self.assertNotEqual(result.returncode, 0)
  self.assertIn("evidence_staging_not_successful", result.stderr)

 def test_workflow_final_gate_rejects_skipped_evidence_staging(self):
  result = self._run_final_gate("success", "skipped")
  self.assertNotEqual(result.returncode, 0)

 def test_successful_evidence_staging_permits_upload_and_final_gate(self):
  workflow = self.scanner_workflow()
  upload = self._workflow_step(workflow, "Upload sanitized evidence only")
  condition = self._workflow_condition(upload)
  self.assertTrue(self._condition_allows(condition, {"stage_evidence":"success"}))
  self.assertEqual(self._run_final_gate("success", "success").returncode, 0)

 def test_upload_condition_blocks_every_non_successful_staging_outcome(self):
  workflow = self.scanner_workflow()
  upload = self._workflow_step(workflow, "Upload sanitized evidence only")
  condition = self._workflow_condition(upload)
  for outcome in ("failure", "skipped", "cancelled"):
   with self.subTest(staging_outcome=outcome):
    self.assertFalse(self._condition_allows(condition, {"stage_evidence":outcome}))

 def test_failed_or_skipped_scanner_cannot_pass_workflow_final_gate(self):
  for outcome in ("failure", "skipped", "cancelled"):
   with self.subTest(scanner_outcome=outcome):
    result = self._run_final_gate(outcome, "success")
    self.assertNotEqual(result.returncode, 0)

 def test_staging_runs_with_always_condition_after_scanner_failure(self):
  workflow = self.scanner_workflow()
  stage = self._workflow_step(workflow, "Validate evidence allowlist and stage sanitized artifact")
  self.assertEqual(self._workflow_condition(stage), "always()")
  self.assertTrue(self._condition_allows(self._workflow_condition(stage), {"scan_evidence":"failure"}))


if __name__=="__main__":
 unittest.main()
