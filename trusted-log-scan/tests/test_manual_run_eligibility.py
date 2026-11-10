import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import trusted_scan as ts

SHA = "a" * 40
RUN_ID = "7001"
EVENT = {"id": RUN_ID, "run_attempt": 1}

def good_metadata():
    return {
        "id": int(RUN_ID),
        "workflow_id": 411977040,
        "name": "Phase 2 Metadata Inventory Prototype",
        "path": ".github/workflows/phase2-metadata-inventory.yml",
        "repository": {"id": 1436066881, "full_name": "Thabiso37/Nova-Ai"},
        "head_repository": {"id": 1436066881, "full_name": "Thabiso37/Nova-Ai"},
        "head_branch": "main",
        "event": "workflow_dispatch",
        "actor": {"login": "Thabiso37", "id": 150135093},
        "triggering_actor": {"login": "Thabiso37", "id": 150135093},
        "status": "completed",
        "conclusion": "success",
        "run_attempt": 1,
        "head_sha": SHA,
    }

class ManualWorkflowRunEligibilityTests(unittest.TestCase):
    def validate(self, meta=None, event=EVENT, mode="future"):
        selected_mode, run_id, _, attempt = ts.validate_event("workflow_run", "irrelevant-scanner-actor", {}, event)
        self.assertEqual(selected_mode, mode)
        return ts.validate_run_metadata(meta or good_metadata(), run_id, mode, event_attempt=attempt)

    def test_authorized_manual_run_accepted(self):
        self.assertEqual(self.validate(), SHA)

    def test_wrong_actor_login_rejected(self):
        for field in ("actor", "triggering_actor"):
            meta = good_metadata()
            meta[field] = dict(meta[field], login="attacker")
            with self.subTest(field=field), self.assertRaisesRegex(ts.Reject, "unauthorized_" + field):
                self.validate(meta)

    def test_wrong_actor_numeric_id_rejected(self):
        for field in ("actor", "triggering_actor"):
            meta = good_metadata()
            meta[field] = dict(meta[field], id=999)
            with self.subTest(field=field), self.assertRaisesRegex(ts.Reject, "unauthorized_" + field + "_id"):
                self.validate(meta)

    def test_missing_actor_metadata_rejected(self):
        for field in ("actor", "triggering_actor"):
            meta = good_metadata()
            del meta[field]
            with self.subTest(field=field), self.assertRaisesRegex(ts.Reject, "missing_" + field):
                self.validate(meta)

    def test_incorrect_repository_identity_rejected(self):
        for field, value, reason in (
            ("repository", {"id": 999, "full_name": "Thabiso37/Nova-Ai"}, "source_repository_mismatch"),
            ("repository", {"id": 1436066881, "full_name": "attacker/Nova-Ai"}, "source_repository_mismatch"),
            ("head_repository", {"id": 999, "full_name": "Thabiso37/Nova-Ai"}, "head_repository_mismatch"),
            ("head_repository", {"id": 1436066881, "full_name": "attacker/Nova-Ai"}, "head_repository_mismatch"),
        ):
            meta = good_metadata()
            meta[field] = value
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ts.Reject, reason):
                self.validate(meta)

    def test_wrong_workflow_identity_rejected(self):
        for field, value, reason in (
            ("workflow_id", 1, "workflow_id_mismatch"),
            ("name", "lookalike", "workflow_name_mismatch"),
            ("path", ".github/workflows/evil.yml", "workflow_path_mismatch"),
        ):
            meta = good_metadata()
            meta[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ts.Reject, reason):
                self.validate(meta)

    def test_wrong_branch_and_event_rejected(self):
        meta = good_metadata()
        meta["head_branch"] = "feature/untrusted"
        with self.assertRaisesRegex(ts.Reject, "source_branch_mismatch"):
            self.validate(meta)
        meta = good_metadata()
        meta["event"] = "push"
        with self.assertRaisesRegex(ts.Reject, "source_event_mismatch"):
            self.validate(meta)

    def test_failed_and_incomplete_source_runs_rejected(self):
        for field, value in (("status", "in_progress"), ("conclusion", "failure"),
                             ("conclusion", "cancelled"), ("conclusion", None)):
            meta = good_metadata()
            meta[field] = value
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ts.Reject, "source_run_not_successful"):
                self.validate(meta)

    def test_repeat_attempt_and_event_attempt_mismatch_rejected(self):
        meta = good_metadata()
        meta["run_attempt"] = 2
        with self.assertRaisesRegex(ts.Reject, "unexpected_run_attempt"):
            self.validate(meta)
        with self.assertRaisesRegex(ts.Reject, "invalid_or_unexpected_workflow_run_attempt"):
            self.validate(event={"id": RUN_ID, "run_attempt": 2})
        with self.assertRaisesRegex(ts.Reject, "event_run_attempt_mismatch"):
            ts.validate_run_metadata(good_metadata(), RUN_ID, "future", event_attempt=2)

    def test_event_run_id_and_attempt_are_strict(self):
        for event in ({"id": "bad", "run_attempt": 1}, {"id": RUN_ID, "run_attempt": True},
                      {"id": RUN_ID, "run_attempt": "1"}, {"id": "", "run_attempt": 1}):
            with self.subTest(event=event), self.assertRaises(ts.Reject):
                ts.validate_event("workflow_run", "x", {}, event)

    def test_invalid_source_sha_and_mismatched_run_id_rejected(self):
        meta = good_metadata()
        meta["head_sha"] = "not-a-sha"
        with self.assertRaisesRegex(ts.Reject, "invalid_source_commit_sha"):
            self.validate(meta)
        meta = good_metadata()
        meta["id"] = 8008
        with self.assertRaisesRegex(ts.Reject, "run_id_mismatch"):
            self.validate(meta)

    def test_duplicate_missing_and_failed_jobs_rejected(self):
        job = {"id": 1, "name": "disposable-postgres-17", "status": "completed", "conclusion": "success"}
        with self.assertRaisesRegex(ts.Reject, "duplicate_target_jobs"):
            ts.validate_jobs([job, dict(job, id=2)], 2)
        with self.assertRaisesRegex(ts.Reject, "missing_target_job"):
            ts.validate_jobs([{"id": 2, "name": "other"}], 1)
        with self.assertRaisesRegex(ts.Reject, "target_job_not_successful"):
            ts.validate_jobs([dict(job, conclusion="failure")], 1)

    def test_incomplete_and_changed_job_pagination_rejected(self):
        job = {"id": 1, "name": "disposable-postgres-17", "status": "completed", "conclusion": "success"}
        with self.assertRaisesRegex(ts.Reject, "incomplete_job_pagination"):
            ts.validate_jobs([job], 2)
        def missing_page(args):
            return {"jobs": [job], "total_count": 2} if "page=1" in args[0] or "page=2" not in args[0] else {"jobs": [], "total_count": 2}
        with self.assertRaisesRegex(ts.Reject, "incomplete_job_pagination"):
            ts.fetch_all_jobs("Thabiso37/Nova-Ai", RUN_ID, missing_page)
        def changed_total(args):
            if "page=2" in args[0]:
                return {"jobs": [{"id": 2, "name": "other"}], "total_count": 3}
            return {"jobs": [job], "total_count": 2}
        with self.assertRaisesRegex(ts.Reject, "job_pagination_total_changed"):
            ts.fetch_all_jobs("Thabiso37/Nova-Ai", RUN_ID, changed_total)

    def test_job_api_failure_rejected(self):
        def failed(args):
            raise RuntimeError("API unavailable")
        with self.assertRaises(RuntimeError):
            ts.fetch_all_jobs("Thabiso37/Nova-Ai", RUN_ID, failed)

    def test_rejected_actor_stops_before_jobs_logs_or_scanner(self):
        class Adapter:
            def __init__(self):
                self.calls = []
            def run_metadata(self, run_id):
                self.calls.append("metadata")
                meta = good_metadata()
                meta["actor"] = {"login": "attacker", "id": 999}
                return meta
            def jobs(self, run_id):
                self.calls.append("jobs")
                raise AssertionError("jobs must not be fetched after rejection")
            def logs(self, job_id):
                self.calls.append("logs")
                raise AssertionError("logs must not be fetched after rejection")
        adapter = Adapter()
        with tempfile.TemporaryDirectory() as d:
            env = {
                "EVENT_NAME": "workflow_run", "DISPATCH_ACTOR": "Thabiso37",
                "DISPATCH_RUN_ID": "", "DISPATCH_SOURCE_SHA": "",
                "EVENT_RUN_ID": RUN_ID, "EVENT_RUN_ATTEMPT": "1",
                "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": "b" * 40,
            }
            with patch.dict(os.environ, env, clear=False), patch.object(ts.pathlib.Path, "cwd", return_value=pathlib.Path(d)):
                with self.assertRaisesRegex(ts.Reject, "unauthorized_actor"):
                    ts.execute(adapter)
        self.assertEqual(adapter.calls, ["metadata"])
        summary = json.loads((pathlib.Path(d) / "trusted-evidence" / "summary.json").read_text())
        self.assertEqual(summary["result"], "FAIL")
        self.assertFalse(summary["raw_logs_uploaded"])

    def test_source_workflow_is_manual_only_and_actions_are_pinned(self):
        workflow = pathlib.Path(".github/workflows/phase2-metadata-inventory.yml").read_text()
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("push:", workflow)
        self.assertIn("postgres:17.11", workflow)
        self.assertIn("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", workflow)
        self.assertIn("actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065", workflow)
        self.assertIn("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", workflow)

    def test_scanner_integrity_failure_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            (root / ".git" / "objects" / "info").mkdir(parents=True)
            (root / "phase2" / "metadata-inventory").mkdir(parents=True)
            def git(args):
                if "HEAD" in args:
                    return "0" * 40
                if "--git-common-dir" in args:
                    return ".git"
                return ""
            with self.assertRaisesRegex(ts.Reject, "scanner_source_commit_mismatch"):
                ts.validate_scanner_checkout(root, git)

if __name__ == "__main__":
    unittest.main(verbosity=2)
