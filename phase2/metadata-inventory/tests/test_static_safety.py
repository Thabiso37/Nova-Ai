import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
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
 def test_catalogue_visibility_includes_shared_security_labels(self):
  self.assertIn("pg_shseclabel",DETECTOR)
  self.assertIn("shared_security_label",DETECTOR)
 def test_transform_and_security_label_positive_probe_families(self):
  probes=(ROOT/"fixtures"/"unsupported_probes.sql").read_text()
  self.assertIn("pg_transform",probes);self.assertIn("SECURITY LABEL FOR phase2_dummy",probes)
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
 def test_complete_workflow_job_logs_are_scanned(self):
  workflow=(ROOT.parents[1]/".github"/"workflows"/"phase2-workflow-log-scan.yml").read_text()
  self.assertIn("workflow_dispatch",workflow)
  self.assertIn("gh run view",workflow)
  self.assertIn("scan_sensitive.py",workflow)

if __name__=="__main__":
 unittest.main()
