# Phase 2 — Catalogue-only metadata inventory prototype

**Status:** experimental Phase 2 implementation; not production-authoritative.  
**Target:** disposable PostgreSQL 17.11 only. No DDL reconstruction or restore test is implemented.

## Safety boundary

The workflow provisions a disposable PostgreSQL 17.11 service with synthetic records. The inventory and unsupported-object detector connect as `novaai_inventory_inspector`, use read-only transactions, and do not intentionally query application table rows. Runtime negative tests execute with the same restricted login.

Never set `INVENTORY_DSN` to a production or Supabase connection. No production credentials or project access are required.

## Files

- `fixtures/bootstrap.sql`: synthetic schemas, canaries, role probes and restricted inspector.
- `inventory.py`: read-only catalogue inventory, preflight, exact provenance classification, dependency resolution and cycle detection.
- `scope.json`: synthetic schema scope.
- `provenance_registry.json`: exact object provenance entries, fixture migration evidence, extension prerequisites and built-in access-method provenance.
- `runtime_security.py`: runtime negative security tests.
- `detect_unsupported.py`: fail-closed discovery of unsupported object families and catalogue visibility gaps.
- `tests/test_static_safety.py`: static regression tests only.
- `validate_artifacts.py`: generated-artifact canary and secret-pattern scan.
- `compare_baseline.py`: comparison of catalogue inventory categories with independent disposable `pg_dump --schema-only` outputs.
- `.github/workflows/phase2-metadata-inventory.yml`: PostgreSQL 17.11 CI workflow.

## Runtime security suite

The runtime suite checks denial of protected table and column SELECT, views and materialized views, invoker and SECURITY DEFINER function execution, privileged-role membership and `SET ROLE` escalation, sequence reads and mutation, large-object creation/read/write/unlink, temporary-object creation, schema/table creation and protected data reads with RLS disabled.

A passing run is evidence only for the synthetic fixture and tested operations. It is not proof of security in a managed Supabase environment or every PostgreSQL permission path.

## Provenance and dependencies

Object classification requires an exact entry in `provenance_registry.json` and matching migration evidence; owner and parent-owner checks are corroboration, not the sole source. Unknown in-scope objects fail closed. Generated array types are represented by explicit registry entries when they occur as dependency endpoints.

Dependencies are resolved through PostgreSQL `pg_identify_object` identities against the provenance registry, approved external prerequisites and approved cluster-global exclusions. Unresolved dependencies and unsupported dependency types fail closed. Strongly connected components are reported as dependency cycles requiring special handling; Phase 2 does not compute a restore order.

The registry describes only the synthetic fixture. It does not establish provenance for NOVAAI production migrations, Supabase-managed schemas or environment-specific objects.

## Unsupported-object discovery

The detector checks aggregates, rules, operators, operator classes/families, foreign tables, FDWs, foreign servers and user mappings, event triggers, publications/subscriptions, text-search objects, extended statistics, casts, collations, conversions, transforms, user-defined type families, security labels and large-object metadata. It also checks access methods against the explicit PostgreSQL 17.11 built-in registry.

A catalogue family that cannot be inspected produces a visibility failure. It is not silently treated as empty.

## Baseline comparison

The workflow generates a schema-only baseline for the two synthetic application schemas and a separate extension-only baseline. The comparator covers relation/sequence identities, table columns, constraints, indexes, functions/procedures, types/domains, triggers, policies, partitions, RLS configuration, extensions, ownership-record presence, ACL metadata presence and resolved dependency nodes.

The comparator does not establish exact privilege-by-privilege ACL equivalence or an independent pg_dump dependency graph. It does not reconstruct DDL, execute a restore, or establish restoration equivalence.

## Artifact and log handling

Generated inventory, baseline and test-result artifacts are scanned for known synthetic canaries and selected sensitive-metadata patterns. Pattern scanning is not proof that all secrets are absent. Workflow logs require separate retrieval and review; the log scan is not inferred from the artifact scan.

## Known acceptance limits

- The registry is synthetic fixture evidence, not a production migration-history registry.
- Supabase-managed and environment-specific provenance classes have no actual objects in this fixture and remain unverified.
- PostgreSQL 17.11 standalone testing does not prove Supabase managed Read Replica compatibility.
- Baseline ownership and ACL comparisons remain coverage checks, not full semantic equivalence.
- Cycles are reported for manual review; no restore ordering or DDL reconstruction is provided.

## Production restriction

No production connection, credential, secret, workflow, permission or artifact is used or authorized. PR #23 and production export workflows remain untouched.
