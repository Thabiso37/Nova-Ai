# NOVAAI Phase 2 F-02 — trusted workflow log scanner

## Sole-owner trust model

The repository has one owner, `Thabiso37`. Owner approval is not independent security review, and no independent reviewer or independent approval is claimed. This design is not an independent trust anchor against a malicious or compromised owner. F-02 remains OPEN until actual source execution, trusted scanning, artifact retrieval and digest verification are completed; independent assessment remains a separate desirable safeguard if a qualified reviewer becomes available.

## Trust and eligibility policy

The trusted orchestrator checks out and executes its own source at the event's `github.sha` into a dedicated directory, and rejects execution unless `GITHUB_REF` is exactly `refs/heads/main`. It separately checks out the fixed approved scanner commit. It only listens for `workflow_run` completions and the typed `repository_dispatch` event. It never checks out candidate branches, downloads candidate artifacts, or evaluates source logs as commands. It checks out only scanner commit `294fa19fac21b5467b9cf2eb0acb428678395575`.

Historical runs use a strict immutable pair allowlist:
- `42640933100` — `41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb`
- `42652510694` — `294fa19fac21b5467b9cf2eb0acb428678395575`

The source workflow identity is checked using the GitHub REST workflow-run response: repository ID `1436066881` and full name `Thabiso37/Nova-Ai`; matching head repository identity; workflow ID `411977040`; exact name `Phase 2 Metadata Inventory Prototype`; canonical API path `.github/workflows/phase2-metadata-inventory.yml`; branch `main`; event `workflow_dispatch`; completed/success status; attempt 1; and a valid 40-character source SHA. Both `actor` and `triggering_actor` must be objects with login `Thabiso37` and numeric ID `150135093`. These fields are present in the documented REST workflow-run representation and were confirmed on a real historical run response. Event run ID and attempt must exactly match the REST response. Job pagination must match a stable API total, contain unique job IDs, and exactly one completed/success `disposable-postgres-17` job must exist.

### Future workflow_run policy

The future-run path accepts only the manually dispatched synthetic workflow on `main`. It does not use a future run-ID/SHA pre-approval list: that design cannot be populated before the completed run automatically activates `workflow_run`. Instead, the completed run is eligible only after every authoritative REST metadata check listed above succeeds. The run ID and attempt from the workflow_run event must match the REST response exactly. No workflow name or ID alone can authorize a run.

The REST workflow-run object exposes `repository`, `head_repository`, `actor`, `triggering_actor`, `workflow_id`, `path`, `head_branch`, `event`, `status`, `conclusion`, `run_attempt`, and `head_sha`. Actor checks use both `actor.login/id` and `triggering_actor.login/id`; they do not use the scanner workflow's `github.actor` as a substitute. Missing, malformed or mismatched fields reject the run before job listing or log retrieval.

The source workflow on `main` is manual-dispatch only. It uses a disposable PostgreSQL 17.11 container, synthetic fixture DDL and localhost-only connection strings. Its complete 26-file `phase2/metadata-inventory/` dependency tree is included. The source workflow's checkout, Python setup and artifact upload actions are pinned to immutable commit SHAs. No production Supabase URL, database secret, production credential or deployment step is configured.

The trusted scanner remains pinned to `294fa19fac21b5467b9cf2eb0acb428678395575`. It checks out only its own trusted main-branch source and that exact scanner source commit. It never checks out the source workflow's commit, downloads source artifacts, or executes source workflow code. Source logs are fetched through the read-only GitHub Actions API and treated as inert data. The scanner retains read-only `actions: read` and `contents: read` permissions, bounded HTTPS log retrieval, scanner integrity checks, raw-log exclusion, strict evidence manifests and atomic staging.

Historical repository_dispatch remains separate and unchanged. It continues to require the exact historical run/SHA pairs listed above and the authorized dispatch actor. The new manual workflow_run path does not require a repository_dispatch credential.

## Dispatch credential

The scanner has only `actions: read` and `contents: read`. It never receives `contents: write`. The repository_dispatch API requires a credential with repository Contents: write permission; the owner must hold and use that credential externally, outside GitHub Actions, and send only the event payload. Do not store it in repository or environment secrets, workflow variables, artifacts, source files, or command-line arguments. Prefer a short-lived GitHub App installation token scoped to this repository; if that is unavailable, a fine-grained PAT restricted to this repository and Contents: write is the minimum documented alternative. The credential is not suitable for the scanner job because it exceeds scanner needs. Keep it in a password manager or secure operator environment, never paste it into chat or CI logs, and revoke/rotate immediately on exposure and periodically. If the owner cannot obtain a narrowly scoped credential, historical dispatch is unavailable; do not weaken scanner permissions. Actor allowlisting is an additional check only.

## Scanner integrity and log handling

Approved scanner hashes:
- `scan_sensitive.py`: `806789ebbe64e39af537415718b6b142d9f94e383def200390e6cf075e4ac238`
- `secret_patterns.py`: `bc76e0af5047a093c093710621f85f1d89f3cb07a8622c6da51dc7088a470233`

The scanner verifies commit identity, a detached isolated clone, Git common-dir containment, symlinks, alternates, remote removal and both file hashes.

### Job-log redirect and response boundary

The job-level endpoint is documented to return HTTP 302 with a temporary download URL. GitHub's self-hosted runner network requirements identify `*.blob.core.windows.net` as required for downloading job summaries, logs, workflow artifacts and caches. The implementation therefore allows only HTTPS DNS subdomains ending in the exact label-boundary suffix `.blob.core.windows.net`; it rejects the suffix apex, lookalike suffixes, IP literals, non-443 ports, URL credentials, fragments, malformed hosts and all other schemes/hosts. This is deliberately narrower than the full runner-domain list. The job-log endpoint documentation does not enumerate individual storage hostnames, so this is a documentation-based domain-family allowlist, not proof of a particular live redirect destination. If GitHub changes its documented storage domain family, retrieval fails closed until reviewed.

Sources:
- GitHub Actions self-hosted runner accessible domains: https://docs.github.com/en/actions/reference/runners/self-hosted-runners (lists `*.blob.core.windows.net` for downloading logs/artifacts)
- GitHub REST API — download job logs: https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run (documents 302 and Location URL, but not a concrete hostname)

At most **3 redirects** are followed. Every redirect is validated before opening and creates a new request with only a fixed User-Agent, Accept and Accept-Encoding headers; Authorization, Cookie and caller credentials are not forwarded. The initial token is sent only to `api.github.com`. Redirect URLs and exception text are never included in rejection messages or evidence. The response must be HTTP 200, `text/plain`, identity content encoding, valid UTF-8, non-empty and free of disallowed control bytes. The stream is read in chunks and rejected immediately when it exceeds **25 MiB**, whether or not Content-Length exists. If Content-Length is supplied, it must be a valid decimal length, no greater than the limit, and exactly match the bytes received. Transfer-Encoding is accepted only as `chunked`, and is rejected if Content-Length is also present. A close-delimited response that ends cleanly without Content-Length cannot be reliably identified as truncated; this implementation does not claim otherwise. The log bytes are SHA-256 hashed before scanning. These are simulated redirect tests through urllib's redirect machinery; they do not demonstrate a live GitHub redirect or trusted main-branch retrieval.

### Evidence manifests and publication

Raw source logs remain runner-local and are excluded from artifacts. The **success manifest** requires `summary.json` (valid JSON with `result=PASS`), `scanner-integrity.json` (valid JSON with a scanner commit), and `scanner-output.txt` containing `SCAN PASS`. The **failure manifest** requires `summary.json` (valid JSON with `result=FAIL`) and a non-empty `failure-reason.txt`. Both manifests reject empty evidence directories, missing required files, unexpected files, symlinks and non-regular files. Success evidence additionally validates the scanner-integrity commit SHA, scanner-output marker, 64-character log SHA-256, source run ID/SHA and selected job ID. Failure evidence must always identify a non-empty failure reason.

Staging copies only the validated manifest into a temporary directory on the destination filesystem, revalidates the staged files, then publishes using an atomic rename to a destination that **must not already exist**. The implementation rejects an existing or symlinked destination; it does not delete-then-replace and does not claim atomic replacement of an existing directory. The upload step runs only when the staging step succeeds and retains `if-no-files-found: error`. Evidence records source run ID/SHA, selected job ID, scanner hashes, log digest where retrieval succeeded, scan outcome and failure reason. A pattern scan is defence in depth and cannot prove arbitrary secrets are absent.

### CI commit identity

The CI evidence distinguishes the two GitHub Actions execution contexts:

- Push run **42784226992** checked out and tested the exact PR branch head `43c73f8350e9e442eb0194d826730174e5e70c91`.
- Pull-request run **42784234903** checked out and tested GitHub's synthetic merge commit `0e1d65fdcd3871a318eaa779f38824bed5a9c86f`, combining the PR head with the base. It did **not** test the exact head commit by itself.

Both runs succeeded, but they are not evidence of two executions against the same commit. New commits to this PR require their own CI results.

After the remediation commits, PR CI run **42792228891** also completed successfully. Its checkout log records synthetic merge commit `458371a916616ef138a5b6977cefb947d8f695ed`, which merges current PR head `042bf0a2f85a9ef2a8e610f0f61ea20272908576` into base `5dd9b7160765774db0b2bb2e16678d215e11558f`. It is a PR merge-result test, not a head-only checkout. The connected Actions listing exposes this PR-triggered run; it does not expose the corresponding push-triggered run, so no push-run ID for `042bf0a2f85a9ef2a8e610f0f61ea20272908576` is asserted here.

## Protections and limitations

The repository has one owner. Do not configure a fictitious independent-review requirement or self-approve as independent. Where available, the owner can configure PR-required changes, disable force pushes and deletion, restrict direct pushes, and require trusted test checks. The connected GitHub API previously reported main unprotected and no rulesets; the branch-protection write operation was not available through the current integration. These controls therefore remain unconfigured/unverified. Owner/admin bypass remains a residual trust risk.

## Acceptance

F-02 remains OPEN. Tests and implementation are not acceptance. Acceptance requires the workflow to be on the default branch, trigger behavior and historical scan execution to be evidenced, artifacts inspected, protection and dispatch constraints documented, and independent assessment where available. F-01 remains closed at `6e44e478536fccf235700cc6db85e97234f32ee7`.
