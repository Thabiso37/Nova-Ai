#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
DIR="${1:?Usage: validate-export.sh <directory>}"
SCHEMA="$DIR/schema.sql"
MANIFEST="$DIR/manifests.json"
fail(){ echo "VALIDATION ERROR: $*" >&2; exit 1; }
[[ -s "$SCHEMA" && -s "$MANIFEST" ]] || fail 'schema.sql/manifests.json missing or empty'
command -v jq >/dev/null || fail 'jq is required'
jq -e '.manifest_version == 1' "$MANIFEST" >/dev/null || fail 'manifest version invalid'
for key in schemas tables_and_columns constraints indexes rls policies schema_grants sequence_grants function_grants role_attributes role_memberships table_grants column_grants default_privileges extensions functions triggers sequences storage_buckets storage_object_policies; do
  jq -e --arg k "$key" '.[$k] | type == "array"' "$MANIFEST" >/dev/null || fail "manifest section missing: $key"
done
jq -e '.tables_and_columns | length > 0' "$MANIFEST" >/dev/null || fail 'no columns in manifest'
jq -e '.product_case_check.lower_exists == true and .product_case_check.upper_exists == true and .product_case_check.distinct == true' "$MANIFEST" >/dev/null || fail 'public.products and public."Products" are not both present as distinct relations'
grep -Eq 'CREATE TABLE[[:space:]]+public\.products([[:space:]]|\()' "$SCHEMA" || fail 'public.products missing from dump'
grep -Eq 'CREATE TABLE[[:space:]]+public\."Products"([[:space:]]|\()' "$SCHEMA" || fail 'public."Products" missing from dump'
if grep -Eiq '^[[:space:]]*(COPY[[:space:]]|INSERT[[:space:]]+INTO[[:space:]])' "$SCHEMA"; then fail 'data statement detected'; fi
if grep -Eiq 'CREATE TABLE[[:space:]]+(auth|storage)\.' "$SCHEMA"; then fail 'Auth/Storage managed tables unexpectedly included'; fi
if grep -Eiq '(postgres(ql)?://[^[:space:]]+|service_role|sb_secret_|BEGIN (OPENSSH|AGE|PGP) PRIVATE KEY|SUPABASE_DB_URL=|password[[:space:]]*[:=])' "$SCHEMA" "$MANIFEST"; then fail 'secret-like string detected'; fi
echo 'Schema and metadata validation passed.'
