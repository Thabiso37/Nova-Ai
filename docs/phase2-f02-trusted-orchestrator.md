# NOVAAI Phase 2 F-02 — trusted workflow log scanner

## Sole-owner trust model

The repository has one owner, `Thabiso37`. No independent reviewer or independent approval is claimed. This design is not an independent trust anchor against a malicious or compromised owner. F-02 remains OPEN until the workflow and evidence are independently assessed if a qualified independent reviewer becomes available.

## Trust and eligibility policy

The trusted orchestrator checks out and executes its own source at the event's `github.sha` into a dedicated directory, and rejects execution unless `GITHUB_REF` is exactly `refs/heads/main`. It separately checks out the fixed approved scanner commit. It only listens for `workflow_run` completions and the typed `repository_dispatch` event. It never checks out candidate branches, downloads candidate artifacts, or evaluates source logs as commands. It checks out only scanner commit `294fa19fac21b5467b9cf2eb0acb428678395575`.

Historical runs use a strict immutable pair allowlist:
- `42640933100` — `41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb`
- `42652510694` — `294fa19fac21b5467b9cf2eb0acb428678395575`

The source workflow identity is checked against the source repository `Thabiso37/Nova-Ai`, ID `411977040`, name `Phase 2 Metadata Inventory Prototype`, path `.github/workflows/phase2-metadata-inventory.yml`, branch `feature/metadata-only-inventory-prototype`, event `push`, completed/success status and attempt 1. Job pagination must match a stable API total, contain unique job IDs, and match the API total, and exactly one completed/success `disposable-postgres-17` job must exist.

### Future workflow_run policy

A workflow name or workflow ID is NOT sufficient to trust a future run. The future-run path is separate from the historical allowlist and starts with an empty `FUTURE_APPROVED_PAIRS`. A future run is rejected unless its exact `(run_id, head_sha)` pair is explicitly added to that set by a reviewed change to this trusted default-branch implementation, after the source run has completed and its workflow identity, branch, event, conclusion, attempt, jobs and provenance have been inspected. Each pair is one-time and attempt 1 only. Do not automatically approve a run from the event itself. Updating the allowlist is a deliberate trust decision, not an automatic name match. This prevents candidate branch writers from gaining eligibility simply by producing another workflow_run event.

## Dispatch credential

The scanner has only `actions: read` and `contents: read`. It never receives `contents: write`. The repository_dispatch API requires a credential with repository Contents: write permission; the owner must hold and use that credential externally, outside GitHub Actions, and send only the event payload. Do not store it in repository or environment secrets, workflow variables, artifacts, source files, or command-line arguments. Prefer a short-lived GitHub App installation token scoped to this repository; if that is unavailable, a fine-grained PAT restricted to this repository and Contents: write is the minimum documented alternative. The credential is not suitable for the scanner job because it exceeds scanner needs. Keep it in a password manager or secure operator environment, never paste it into chat or CI logs, and revoke/rotate immediately on exposure and periodically. If the owner cannot obtain a narrowly scoped credential, historical dispatch is unavailable; do not weaken scanner permissions. Actor allowlisting is an additional check only.

## Scanner integrity and log handling

Approved scanner hashes:
- `scan_sensitive.py`: `806789ebbe64e39af537415718b6b142d9f94e383def200390e6cf075e4ac238`
- `secret_patterns.py`: `bc76e0af5047a093c093710621f85f1d89f3cb07a8622c6da51dc7088a470233`

The scanner verifies commit identity, a detached isolated clone, Git common-dir containment, symlinks, alternates, remote removal and both file hashes. Job-level logs are retrieved through the GitHub job-log endpoint, which redirects to plain text. The initial request authenticates only to api.github.com; a custom HTTPS redirect handler constructs a fresh unauthenticated request to the temporary download host. The final response must be HTTP 200, text/plain, valid UTF-8, non-empty, free of binary control bytes, and within the configured byte limit. Content-Length is checked when supplied. The retrieved bytes are SHA-256 hashed before scanning. Empty, oversized, malformed, inconsistent-length and HTTP-failed responses fail closed. Logs are data only. Raw log bytes are runner-local and never part of the evidence allowlist. The artifact manifest rejects unexpected files, symlinks and raw log inclusion; staging builds a temporary directory, validates its complete contents, then atomically publishes it. The upload step runs only when staging succeeds and errors if no files are present. Evidence records source run ID/SHA, selected job ID, scanner hashes, log digest, scan outcome and failure reason. An allowlisted evidence manifest excludes the runner-local raw log and rejects unexpected files. A pattern scan is defence in depth and cannot prove arbitrary secrets are absent.

## Protections and limitations

The repository has one owner. Do not configure a fictitious independent-review requirement or self-approve as independent. Where available, the owner can configure PR-required changes, disable force pushes and deletion, restrict direct pushes, and require trusted test checks. The connected GitHub API previously reported main unprotected and no rulesets; the branch-protection write operation was not available through the current integration. These controls therefore remain unconfigured/unverified. Owner/admin bypass remains a residual trust risk.

## Acceptance

F-02 remains OPEN. Tests and implementation are not acceptance. Acceptance requires the workflow to be on the default branch, trigger behavior and historical scan execution to be evidenced, artifacts inspected, protection and dispatch constraints documented, and independent assessment where available. F-01 remains closed at `6e44e478536fccf235700cc6db85e97234f32ee7`.
