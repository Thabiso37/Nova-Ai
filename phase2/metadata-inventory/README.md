# Phase 2 — Metadata inventory prototype (synthetic PostgreSQL 17.11 only)

No production connection, credentials, DDL reconstruction, restore test, merge or deployment is authorized.

## Security and evidence boundary

A dedicated inspector uses a read-only repeatable-read transaction. A separate security audit checks role attributes and memberships, role/database configuration, effective search_path, executable SECURITY DEFINER routines, large-object API privileges and the foreign-user-mapping column boundary. Runtime denial tests accept only SQLSTATE 42501; read-only transaction errors do not prove insufficient privileges.

One coordinator transaction exports a PostgreSQL snapshot. Inventory, dependency baseline and structured catalogue baseline import that exact snapshot while the coordinator remains open. A concurrent DDL test demonstrates that a later committed catalogue object is absent from the imported snapshot and visible to a fresh snapshot.

## Provenance

The Phase 1 specification is a versioned transcription and must be reconciled against any canonical original approval record before formal sign-off. The registry is synthetic only. Fixture migration entries include exact repository paths and Git blob SHA identities. The verifier rejects missing or changed files, duplicate migration IDs, duplicate object identities and missing references. PostgreSQL bootstrap and built-in catalogue prerequisites are separately identified. No production migration provenance is claimed.

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


### Additional remediation evidence

The structured catalogue comparator is authoritative for supported metadata properties and requires the exact support-matrix section set plus the positive-probe report from the same workflow run. The pg_dump parser remains a supplemental coverage check only; it is not used as the sole schema comparator.

The shared \`secret_patterns.py\` policy is imported by both the inventory field scanner and the evidence/log scanner. The separate manually dispatched \`.github/workflows/phase2-workflow-log-scan.yml\` accepts a completed run ID, retrieves that job's full GitHub Actions log stream with the GitHub CLI, and scans it with the same policy. In the remediation run, the completed job log was also independently scanned after completion with all 21 shared patterns.

The security-label probe compiles a disposable C provider against PostgreSQL 17.11, loads it in the fixture session, and uses actual \`SECURITY LABEL\` DDL for both an ordinary table and a shared database object; cleanup removes both labels through the same provider. The transform probe remains a synthetic \`pg_transform\` catalogue row inserted only in the disposable fixture with \`allow_system_table_mods\`; it validates discovery/classification, not \`CREATE TRANSFORM\` DDL semantics.
