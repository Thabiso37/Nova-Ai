# Phase 2 — Catalogue-only metadata inventory prototype

**Status:** experimental prototype; not production-authoritative.  
**Target:** disposable PostgreSQL 17.x only. No DDL reconstruction is implemented.

## Safety boundary

The inspector connects as a dedicated login with no application-table or column SELECT, no app-function EXECUTE, no role memberships, no ownership, no TEMP/CREATE, and no sequence access. The bootstrap account creates synthetic fixtures only. The inventory engine uses PostgreSQL catalogues and definition functions; it does not query fixture table rows.

The prototype refuses to run without `INVENTORY_DSN`. Never set that variable to a production or Supabase connection. The checked-in workflow supplies only a local disposable database.

## Layout

- `fixtures/bootstrap.sql`: synthetic schema and restricted roles.
- `inventory.py`: strict preflight, catalogue inventory and fail-closed checks.
- `scope.json`: explicit synthetic scope and classification.
- `requirements.txt`: Python dependency.
- `tests/test_static_safety.py`: static regression checks.
- `.github/workflows/phase2-metadata-inventory.yml`: disposable PostgreSQL 17.11 workflow.

## Local execution

Requires Docker, Python 3.11+, and psql.

```sh
docker run --rm -d --name novaai-pg17 -e POSTGRES_PASSWORD=admin-test-only -e POSTGRES_DB=inventory_test -p 55432:5432 postgres:17.11
until pg_isready -h 127.0.0.1 -p 55432 -U postgres; do sleep 1; done
PGPASSWORD=admin-test-only psql -h 127.0.0.1 -p 55432 -U postgres -d inventory_test -f phase2/metadata-inventory/fixtures/bootstrap.sql
python -m pip install -r phase2/metadata-inventory/requirements.txt
INVENTORY_DSN='host=127.0.0.1 port=55432 dbname=inventory_test user=novaai_inventory_inspector password=local-test-only' \
  python phase2/metadata-inventory/inventory.py --output inventory.json
```

The first prototype is deliberately conservative. If the preflight finds any effective app SELECT, app function execution, large-object routine execution, ownership, schema creation or sequence privileges, it fails.

## Inventory format

JSON format version 1 includes snapshot identity, object records, columns, constraints (including domain constraints), indexes, routines, triggers, types, enums, policies, partitions, extensions, dependencies, ACL metadata and security preflight evidence.

The snapshot is repeatable-read and read-only. The snapshot identifier is recorded. No DDL is emitted.

## Classification

Classification is explicit in `scope.json`. Objects in the approved schema list must have an explicit class. Schema names do not prove ownership. Objects outside the explicit scope are not exported by this prototype.

## Support status

The prototype recognizes schemas, relations, tables, partitions, views, materialized views, sequences, indexes, routines, triggers, types, domains, enums, constraints, policies and extensions. Other object families are not yet reconstructed or comprehensively detected. The next step must add a global unsupported-object detector before claiming completeness.

## Security and limitations

- RLS is not used as the security boundary.
- No application rows are intentionally queried.
- No production connection, secret or workflow is used.
- The scanner rejects obvious credential patterns and never prints matched values.
- Pattern scanning is not a proof that all secrets are detected.
- The role preflight and fixture tests are not an independent security review.
- PostgreSQL 17.11 local CI is not Supabase compatibility evidence.
- The trusted administrative `pg_dump --schema-only` comparison is performed only against disposable fixtures and is not a DDL restoration test.
- Supabase-managed Read Replica compatibility remains untested.
- No production use is authorized by this prototype.
