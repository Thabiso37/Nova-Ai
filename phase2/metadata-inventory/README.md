# Phase 2 — Catalogue-only metadata inventory prototype

**Status:** incomplete experimental prototype; not production-authoritative.  
**Target:** disposable PostgreSQL 17.11 only. No DDL reconstruction is implemented.

## Safety boundary

The workflow provisions a local disposable PostgreSQL service and synthetic fixtures. The inspector uses a dedicated login intended to have no application-table or column SELECT, no app-function EXECUTE, no role memberships, no ownership, no TEMP/CREATE and no sequence access. The runtime negative tests execute using that login and record only test names and SQLSTATEs; exception text and synthetic values are not emitted.

The inventory engine uses PostgreSQL catalogues and definition functions. It does not intentionally query fixture table rows. It uses a read-only repeatable-read transaction. Never set `INVENTORY_DSN` to a production or Supabase connection.

## Files

- `fixtures/bootstrap.sql`: synthetic schema, canaries, role probes and restricted inspector.
- `inventory.py`: security preflight and initial catalogue inventory.
- `scope.json`: explicit synthetic scope and owner-provenance registry.
- `runtime_security.py`: runtime negative tests.
- `tests/test_static_safety.py`: static regression tests only.
- `validate_artifacts.py`: generated-artifact canary and pattern scan.
- `compare_baseline.py`: limited identity-only comparison against disposable administrative pg_dump.
- `.github/workflows/phase2-metadata-inventory.yml`: PostgreSQL 17.11 disposable CI workflow.

## Current implemented checks

The runtime suite attempts to verify denial of protected table/column reads, view and materialized-view access, invoker and SECURITY DEFINER routine execution, privileged-role inheritance, sequence read/mutation, large-object read/write/create/unlink, temporary-object creation, schema/table creation, and protected data reads from a table with RLS disabled.

The workflow scans the generated inventory, schema-only baseline and runtime result for the known synthetic canaries and selected secret patterns. A successful static test run is not runtime security evidence. Only a successful PostgreSQL 17.11 workflow run with inspectable logs and artifacts can establish that the current checks executed.

## Known acceptance gaps — do not treat as complete

- The object inventory is not a complete PostgreSQL catalogue exporter.
- Provenance currently maps an exact owner role to a class for relation objects. It does not yet classify every schema, routine, type, dependency, Supabase-managed object, extension-owned object, cluster-global object or environment-specific object. Unknown object families are not comprehensively discovered.
- Dependency rows are currently raw catalogue OID records. They are not resolved to inventory identities, explicit external prerequisites, extension-owned dependencies or approved exclusions; cycles and unsupported dependency kinds are not classified.
- Unsupported-object discovery is incomplete. Aggregates, rules, operators/casts, access methods/opclasses, foreign-data objects, event triggers, publications/subscriptions, text-search objects, extended statistics, security labels and all user-defined type families are not comprehensively inventoried and failed closed.
- The baseline comparator checks relation identities only. It does not compare columns, constraints, indexes, routines, types/domains, triggers, partitions, extensions, ownership, ACLs, RLS configuration or dependencies.
- Secret detection is pattern-based and is not proof of secret absence. Workflow logs are not separately scanned or downloaded by the workflow. The artifact scan is limited to generated files passed to it.
- Runtime assertions and SQL fixtures still require a successful PostgreSQL 17.11 run and independent review. A workflow that has merely been configured is not evidence of passing tests.
- No restoration equivalence is claimed. No DDL reconstruction is implemented.
- Supabase-managed Read Replica compatibility is untested.

## Local execution

Requires Docker, Python 3.11+, and psql. Use only a disposable local database. See the workflow for the canonical PostgreSQL 17.11 sequence.

## Production restriction

No production connection, credential, secret, workflow, permission or artifact is used or authorized by this prototype. PR #23 and production export workflows must remain untouched.
