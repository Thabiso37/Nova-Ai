# NOVAAI production schema export (encrypted, manual only)

## Scope

This is a schema-documentation export, not a backup. It must not contain table records, Auth users, customer data, Storage objects, credentials, or secrets. The workflow is manual-only and rejects any ref other than `main`; it uses the protected GitHub Environment `production-schema-export`.

Before any dispatch, configure that Environment with required reviewer approval and a deployment branch rule restricted to `main`. Add Environment secret `SUPABASE_DB_URL` containing a dedicated read-only PostgreSQL login (never service-role, owner, postgres, or migration credentials). Add Environment variable `AGE_RECIPIENT` containing only the age public recipient. The private age identity remains offline and must never be stored in GitHub, the repository, or a runner.

## Export contents

`scripts/schema-export/dump-schema.sh` invokes PostgreSQL 17.11 `pg_dump` directly with `--no-password --schema-only --schema=public --schema=private --strict-names`. Strict-name matching makes a missing requested schema fail instead of silently producing a partial export. The command is limited to `public` and `private`; it does not include unrelated schemas. PostgreSQL's default ownership and ACL output is retained (no `--no-owner` or `--no-privileges` flags). The restricted login is never granted membership in, or permission to `SET ROLE`, `postgres`. `export-manifests.sql` reads catalog and metadata views for columns/defaults/types, constraints, indexes, RLS state/policies, grants/default privileges, extensions, function definitions/security mode, triggers, sequences, Storage bucket configuration and Storage object policies. It reads no Storage objects and never queries `auth.users` or application/customer rows.

The manifest explicitly checks that `public.products` and `public."Products"` both exist and have different relation OIDs. The validator also requires both definitions in the schema dump. A missing table or case-folding/collision issue fails the run.

## Toolchain and checks

- Runner: `ubuntu-24.04`.
- PostgreSQL client: `postgres:17.11-bookworm`; both `pg_dump` and `psql` must report exactly 17.11. Production and isolated tests use the same `dump-schema.sh` helper.
- age: Debian package `1.1.1-1+b3`; version asserted.
- GitHub checkout and upload-artifact actions are pinned to full commit SHAs.

The production export opens a persistent read-only `REPEATABLE READ` coordinator transaction and obtains `pg_export_snapshot()`. It keeps that connection open while `pg_dump --snapshot` creates `schema.sql` and a second read-only `REPEATABLE READ` transaction imports the identical identifier with `SET TRANSACTION SNAPSHOT` before running `export-manifests.sql`. Neither file is published until both operations succeed and the coordinator closes cleanly. Any failure discards both staged outputs; bounded retries restart the complete pair with a fresh snapshot. There is no independent-snapshot fallback. The production command is exercised against a genuine isolated PostgreSQL 17.11 physical hot standby using the same restricted login and shared helper. Tests verify strict schema scope, ownership/grant output, absence of application rows and large-object contents, plus manifest generation, validation, encryption, checksums and cleanup. This does not constitute a test against a Supabase-managed replica or the production database. Before first production use, verify the pinned container image digest provenance and GitHub Environment protection settings.

`validate-export.sh` checks required JSON sections, both case-sensitive product relations, schema-only output, absence of Auth/Storage table definitions, and common secret patterns. Plaintext files are placed under a private runner temp directory, checksummed, archived and encrypted to the public recipient. Only the `.age` ciphertext and its SHA-256 file are named as artifact upload paths. The private key is never available to the workflow.

## Offline decryption

Generate and protect the private identity offline. Publish only its recipient string as `AGE_RECIPIENT`:

```sh
age-keygen -o novaai-schema-restore.key
# Keep novaai-schema-restore.key offline and encrypted at rest.
```

Verify the downloaded ciphertext checksum before decryption. Then decrypt on a trusted machine and verify the internal file checksums:

```sh
sha256sum -c SHA256SUMS
age -d -i novaai-schema-restore.key novaai-production-schema.tar.gz.age > schema-export.tar.gz
tar -xzf schema-export.tar.gz
sha256sum -c SHA256SUMS
```

## Important limitations and prerequisites

- The GitHub Environment protection and reviewer configuration are external settings and must be verified manually.
- The read-only database role must be tested for required catalog, function-definition and Storage metadata visibility in an isolated environment. Missing permissions must fail closed.
- Snapshot coordination requires all three connections to reach the same PostgreSQL database instance. Compatibility with Supabase-managed Read Replicas has not been verified and must not be assumed.
- Long-lived snapshots can retain old row versions and can be cancelled by hot-standby WAL replay conflicts. The helper fails closed and retries the entire pair with a fresh snapshot; it does not change replay-delay or feedback settings.
- The standard dump is scoped to `public,private`; managed Auth/Storage schemas, Auth provider settings, secrets, Edge Function environment values, and other Supabase platform configuration are not exported.
- Function source text is included in schema documentation; scan and manually review it for hard-coded secrets before sharing the encrypted archive.
- This workflow's existence does not authorise a production export. A separate explicit approval is required before a reviewer dispatches it from `main`.
- No production export is run by pull-request checks or by implementation itself.
