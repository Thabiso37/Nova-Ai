# NOVAAI Phase 2 F-02 — trusted workflow log scanner

## Trust model and scope

This repository currently has one owner, `Thabiso37`. There is no independent reviewer configured or claimed. The owner can change the default branch and repository settings; this design reduces accidental/self-service workflow bypass but cannot create independent governance. A successful run is implementation evidence, not independent security approval or F-02 acceptance.

The trusted orchestrator is intended to be merged to `main` and is activated only by `workflow_run` and the typed `repository_dispatch` event. It never checks out candidate branches, downloads candidate artifacts, or executes source log contents. It checks out only the fixed approved scanner commit and makes a separate isolated clone before executing the scanner.

## Approved historical sources

Only these historical run/SHA pairs are accepted:
- `42640933100` — `41c91e5b8be9bb1648eba7ddedbc9ff27ebfabbb`
- `42652510694` — `294fa19fac21b5467b9cf2eb0acb428678395575`

The source workflow identity is checked against workflow ID `411977040`, name `Phase 2 Metadata Inventory Prototype`, path `.github/workflows/phase2-metadata-inventory.yml`, branch `feature/metadata-only-inventory-prototype`, event `push`, completed/success conclusion and attempt 1. The complete paginated job list is compared with the API total; exactly one completed/success `disposable-postgres-17` job is required.

For future workflow_run events, run IDs are obtained from the GitHub event and the source commit SHA is validated against the run metadata. The source branch workflow is not treated as trusted code: its logs remain untrusted data. The source workflow has no production credentials and this scanner has only Actions read and Contents read permissions.

## Historical dispatch credential

The scanner does not receive or store a dispatch credential. An operator must use a repository-scoped fine-grained PAT or GitHub App installation token held outside Actions, with only repository Contents: write permission needed by the repository_dispatch API. Do not place this credential in repository secrets, workflow inputs, artifacts, shell command arguments, or logs. The dispatch API requires write access to create the event; the scanner itself remains read-only. Dispatch actor allowlisting is an additional check, not a substitute for token permissions.

Credential ownership: the repository owner is responsible for creating, securely storing and using the dispatch-only credential. Rotate/revoke it immediately after suspected exposure and on a documented periodic schedule; use a short lifetime where the issuing mechanism supports it. If a credential with narrowly scoped dispatch permission cannot be issued, historical dispatch is blocked; do not add contents: write to the workflow. Actor allowlisting currently permits only `Thabiso37`.

Example API payload (send from the operator's secure environment; do not commit or store the token):
```json
{
  "event_type": "phase2-approved-log-scan",
  "client_payload": {
    "target_run_id": "42652510694",
    "target_source_sha": "294fa19fac21b5467b9cf2eb0acb428678395575"
  }
}
```

## Scanner integrity and evidence

Approved scanner SHA: `294fa19fac21b5467b9cf2eb0acb428678395575`.
- `scan_sensitive.py`: `806789ebbe64e39af537415718b6b142d9f94e383def200390e6cf075e4ac238`
- `secret_patterns.py`: `bc76e0af5047a093c093710621f85f1d89f3cb07a8622c6da51dc7088a470233`

The workflow creates a detached isolated clone with no hardlinks/local object sharing, verifies commit identity, checks symlinks and alternates, removes the remote, and verifies both file hashes. Raw job logs stay on the runner and are explicitly excluded from uploaded artifacts. Sanitized evidence records run/job identity, scanner hashes, log digest, scan result and rejection reason. Pattern scanning is defence in depth and cannot prove that arbitrary or obfuscated secrets are absent.

## Repository protection and limits

Configure `main` protection using available GitHub repository settings: require PRs where feasible; prohibit force pushes and deletion; restrict direct pushes to the owner/maintainers; require the trusted scanner test check where supported. Do not configure a one-approval rule that the sole owner would satisfy themselves, and do not claim independent review. If GitHub plan/permissions or the one-owner model prevents a control, record it as unenforced rather than bypassing the owner or locking them out. Repository administration controls and sole-owner authority remain residual trust risks.

## Acceptance boundary

F-02 remains OPEN until the trusted workflow is on `main`, repository protections and credential constraints are evidenced, historical and future trigger behavior has been exercised, sanitized artifacts independently checked, and a genuinely independent reviewer (if one becomes available) assesses the evidence. Passing automated tests alone is not acceptance. F-01 remains closed at `6e44e478536fccf235700cc6db85e97234f32ee7`.


## Implementation note
The pull-request test workflow is intentionally read-only and exercises the trusted scanner's fixed pair/hash policy and artifact/trigger boundaries. The actual orchestrator cannot execute historical scans until it is present on the default branch and a dispatch credential is available.
