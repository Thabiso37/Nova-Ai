# Phase 2 — Catalogue-only metadata inventory prototype

**Status:** experimental Phase 2 implementation; ready for independent review only when the latest PostgreSQL 17.11 workflow and its artifacts pass.  
**Target:** disposable PostgreSQL 17.11 only. No DDL reconstruction or restore test is implemented.

## Safety boundary

The workflow provisions a disposable PostgreSQL 17.11 service with synthetic records. The inventory and unsupported-object detector connect as `novaai_inventory_inspector` and use read-only transactions. Runtime negative tests use the same restricted login. The separate administrative baseline process reads catalogue metadata only and never selects application-table rows.

Never set `INVENTORY_DSN` or `BASELINE_DSN` to a production or Supabase connection. No production credentials or project access are required.

## Files

- `fixtures/bootstrap.sql`: synthetic schemas, canaries, role probes and restricted inspector.
- `inventory.py`: read-only catalogue inventory, privilege preflight, exact provenance classification, dependency resolution and cycle detection.
- `scope.json`: explicit synthetic schema scope; it does not classify by schema name or role.
- `provenance_registry.json`: exact object provenance entries, synthetic migration-history evidence, external prerequisites and cluster-global access-method provenance.
- `runtime_security.py`: runtime negative security tests.
- `baseline_dependencies.py`: independent administrative dependency snapshot for the disposable fixture.
- `detect_unsupported.py`: fail-closed discovery of unsupported object families and catalogue visibility gaps.
- `tests/test_static_safety.py`: static regression tests only.
- `validate_artifacts.py`: generated-artifact canary and selected sensitive-metadata pattern scan.
- `compare_baseline.py`: semantic catalogue comparison against independent disposable `pg_dump --schema-only` and administrative dependency baselines.
- `.github/workflows/phase2-metadata-inventory.yml`: PostgreSQL 17.11 CI workflow.

## Runtime security suite

The runtime suite checks denial of protected table and column SELECT, views and materialized views, invoker and SECURITY DEFINER function execution, privileged-role membership and `SET ROLE` escalation, sequence reads and mutation, large-object creation/read/write/unlink, temporary-object creation, schema/table creation, protected data reads with RLS disabled, and user-defined type USAGE.

A passing run is evidence only for the synthetic fixture and tested operations. It is not proof of security in a managed Supabase environment or every PostgreSQL permission path.

## Provenance and dependencies

Object classification requires an exact entry in `provenance_registry.json` and matching migration-history evidence. Owner and parent-owner checks are corroboration, not the sole source of classification. The registry accepts only the explicit classes `NOVAAI_OWNED`, `SUPABASE_MANAGED`, `EXTENSION_OWNED`, `CLUSTER_GLOBAL` and `ENVIRONMENT_SPECIFIC`. Duplicate identities, invalid classes and missing migration evidence fail closed.

The disposable fixture includes:
- NOVAAI-owned schema objects.
- A synthetic Supabase-managed provenance probe, explicitly labelled as a test fixture and not an actual Supabase-managed object.
- A synthetic environment-specific provenance probe, not an actual NOVAAI deployment setting.
- The PostgreSQL `plpgsql` extension/language as extension-owned prerequisites.
- PostgreSQL 17.11 built-in access methods as cluster-global prerequisites.

Dependencies are resolved through PostgreSQL `pg_identify_object` identities against the provenance registry, approved external prerequisites and approved cluster-global exclusions. Unresolved dependencies and unsupported dependency types fail closed. Strongly connected components are reported as dependency cycles requiring special handling; Phase 2 does not compute a restore order. The inventory dependency graph is compared against a separate administrative catalogue snapshot.

The registry describes only synthetic fixture evidence. It does not establish provenance for NOVAAI production migrations, actual Supabase-managed schemas or environment-specific production objects.

## Unsupported-object discovery

The detector checks aggregates, rules, operators, operator classes/families, foreign tables, foreign-data wrappers, foreign servers and user mappings, event triggers, publications/subscriptions, text-search objects, extended statistics, casts, collations, conversions, transforms, user-defined type families, security labels and large-object metadata. It checks access methods against the explicit PostgreSQL 17.11 external-prerequisite registry. User-mapping discovery has column-level SELECT on `umuser` and `umserver` only; it never has SELECT on or reads `umoptions`, which is separately tested as denied.

A catalogue family that cannot be inspected produces a visibility failure. It is not silently treated as empty. The workflow positively injects an extended-statistics object, a custom rule and a user-defined range/multirange type; it requires the detector to fail closed on all three families, then drops the probes and requires a clean full scan. Other unsupported families are covered by explicit catalogue queries and static matrix checks, but do not yet each have a positive fixture probe.

## Baseline comparison

The workflow generates a schema-only baseline for the synthetic application and provenance-probe schemas, plus a separate administrative dependency snapshot. The comparator covers relation/sequence identities, table columns and their types/nullability/defaults/identity/generated attributes, constraints, indexes, functions/procedures and selected routine properties, types/domains/enums, triggers, policies, partitions, RLS configuration, extensions, exact owner identities for the compared top-level families, explicit non-owner ACL grants and PUBLIC revocations, and dependency edges.

Default-privilege metadata is inventoried, but full default-privilege semantic equivalence is not asserted. The comparator does not reconstruct DDL, execute a restore, or establish restoration equivalence.

## Artifact and log handling

Generated inventory, schema baseline, dependency baseline and test-result artifacts are scanned for known synthetic canaries and selected sensitive-metadata patterns. The latest workflow job logs are retrieved separately and reviewed for canary and selected sensitive-pattern leakage. Pattern scanning is not proof that all secrets are absent.

## Known acceptance limits

- All evidence is from disposable synthetic PostgreSQL 17.11, not a NOVAAI production catalogue.
- The Supabase-managed and environment-specific classes are exercised using explicit synthetic provenance probes only; actual Supabase and production migration-history provenance remain unverified.
- PostgreSQL 17.11 standalone testing does not prove Supabase managed Read Replica compatibility.
- Unsupported-object detection has not yet been positively injected and exercised for every listed family.
- Baseline default-privilege semantics are inventoried but not fully compared.
- Dependency cycles are reported for manual review; no restore ordering or DDL reconstruction is provided.

## Production restriction

No production connection, credential, secret, permission or artifact is used or authorized. PR #23 and the production export workflow remain untouched.
