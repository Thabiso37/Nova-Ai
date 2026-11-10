# Phase 2 — Metadata inventory prototype (synthetic PostgreSQL 17.11 only)

No production connection, credentials, DDL reconstruction, restore test, merge or deployment is authorized.

## Security and evidence boundary

A dedicated inspector uses a read-only repeatable-read transaction. A separate security audit checks role attributes and memberships, role/database configuration, effective search_path, executable SECURITY DEFINER routines, large-object API privileges and the foreign-user-mapping column boundary. Runtime denial tests accept only SQLSTATE 42501; read-only transaction errors do not prove insufficient privileges.

One coordinator transaction exports a PostgreSQL snapshot. Inventory, dependency baseline and structured catalogue baseline import that exact snapshot while the coordinator remains open. A concurrent DDL test demonstrates that a later committed catalogue object is absent from the imported snapshot and visible to a fresh snapshot.

## Provenance

The Phase 1 specification is a versioned transcription. The Phase 2 requirements transcription is owner-confirmed as accurately representing the original approved Phase 2 scope (2026-11-10); this confirmation does not itself constitute formal Phase 2 acceptance. The registry is synthetic only. Fixture migration entries include exact repository paths and Git blob SHA identities. The verifier rejects missing or changed files, duplicate migration IDs, duplicate object identities and missing references. PostgreSQL bootstrap and built-in catalogue prerequisites are separately identified. No production migration provenance is claimed.

## Catalogue visibility and unsupported families

The detector records query execution, catalogue relation existence, required SELECT permission and discovered object count. It checks pg_seclabel and pg_shseclabel without selecting label values. Positive probes cover aggregates, rules, extended statistics, range/multirange types and casts, foreign tables, FDW/server/user mappings, publications/subscriptions, custom operators, operator classes/families, event triggers, collations, text-search configurations/dictionaries/parsers/templates, character conversions, user-defined languages and large-object metadata. The inspector receives identity-only column grants; FDW/server/table options, subscription connection strings, mapping options, security-label values and large-object contents are denied.

Security-label object discovery remains provider-dependent. Where a label provider cannot be installed and positively exercised, the detector reports PARTIAL rather than claiming a complete pass. That partial result blocks acceptance.

## Baseline comparison

A structured administrative catalogue baseline compares relation and view/materialized-view definitions, columns, constraints, indexes, complete routine signatures and definitions, sequence configuration and ownership, triggers, types/enums, policies, partitions, extensions, ACLs and default privileges. Overloaded routines retain argument signatures. The pg_dump comparison is supplemental. Neither comparison is a restore test or restoration-equivalence claim.

The pg_dump client runs from the PostgreSQL 17.11 image; server and client versions are recorded.

## Secret handling

A shared scanner checks evidence artifacts and captured command output for synthetic canaries, credential assignments, bearer tokens, JWTs, common cloud credentials, database URIs and private-key markers. Runtime probes avoid printing exception details. Pattern scanning is defence in depth and cannot prove arbitrary secrets absent. Captured command output is not a substitute for scanning every GitHub platform-generated log line.

## Acceptance boundary

A PARTIAL visibility result, unverified provider-dependent probe, unsupported object, visibility failure, snapshot mismatch, missing provenance evidence, security audit failure or metadata mismatch blocks acceptance. Passing CI does not establish production security, managed Supabase compatibility or restoration equivalence.

## Main-branch synthetic execution status

The synthetic PostgreSQL 17.11 source workflow completed successfully on `main` at commit `6506a966d39c41e7240186a3c392af9cd6eb423d`, run [42800792137](https://github.com/Thabiso37/Nova-Ai/actions/runs/42800792137). This is the successful main-branch synthetic operational run; any earlier statement that no such successful run had been accepted is superseded by this recorded result. The run's technical success is evidence of prototype execution, not a declaration of formal Phase 2 acceptance.

### Additional remediation evidence

The structured catalogue comparator is authoritative for supported metadata properties and requires the exact support-matrix section set plus the positive-probe report from the same workflow run. The pg_dump parser remains a supplemental coverage check only; it is not used as the sole schema comparator.

The shared `secret_patterns.py` policy is imported by both the inventory field scanner and the approved evidence/log scanner. The trusted `.github/workflows/phase2-trusted-workflow-log-scan.yml` runs from trusted `main` after a completion event from the manual-only synthetic source workflow. It validates the exact repository, workflow, source-run metadata and both REST actor identities, retrieves only the selected job log through the read-only Actions API, and scans it with the scanner pinned to the approved commit. Raw source logs remain runner-local and are excluded from uploaded evidence. The source workflow completed successfully on 2026-11-10 as run [42800792137](https://github.com/Thabiso37/Nova-Ai/actions/runs/42800792137) at commit `6506a966d39c41e7240186a3c392af9cd6eb423d`. The trusted scanner then completed automatically as run [42800891197](https://github.com/Thabiso37/Nova-Ai/actions/runs/42800891197). F-02 is CLOSED — ACCEPTED; its implementation and accepted evidence are preserved unchanged.

The security-label probe compiles a disposable C provider against PostgreSQL 17.11, loads it in the fixture session, and uses actual `SECURITY LABEL` DDL for both an ordinary table and a shared database object. A separate assertion records only the two row counts and explicitly records that label values were not read; cleanup removes both labels through the same provider. The transform probe now uses actual `CREATE TRANSFORM` DDL with disposable C conversion functions. The functions are metadata-only stubs and are never invoked; cleanup drops the transform and both functions.

## Phase 2 live execution and closeout

The synthetic PostgreSQL 17.11 source workflow passed on `main` at `6506a966d39c41e7240186a3c392af9cd6eb423d` (run `42800792137`). The structured catalogue comparison and supplemental `pg_dump` comparison both returned `PASS`; their machine-readable stdout was recovered from the source job log and retained under `docs/phase2/evidence/source-run-42800792137/`. The original uploaded inventory artifact remains unchanged: ID `13756530949`, SHA-256 `99920e7263f5654922f901418dbf693c3b8313e4d93a203b882c9047bdd4fb7c`.

F-02 — Trusted Workflow Log Scanner is CLOSED — ACCEPTED. Its implementation, approved scanner commit and historical evidence are not changed by this documentation-only closeout. See [`docs/phase2/f02-acceptance-status.md`](../../docs/phase2/f02-acceptance-status.md).

The Phase 2 closeout requirements, mapping, governance review and acceptance-readiness report are maintained under [`docs/phase2/`](../../docs/phase2/). Phase 2 remains limited to the approved synthetic inventory prototype. DDL reconstruction, clean restoration, restoration equivalence, Supabase non-production compatibility and independent security review remain separately phased roadmap work, not retroactive Phase 2 requirements.
