#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
DIR="${1:?Usage: validate-export.sh <directory>}"
SCHEMA="$DIR/schema.sql"
MANIFEST="$DIR/manifests.json"
fail(){ echo "VALIDATION ERROR: $*" >&2; exit 1; }
[[ -s "$SCHEMA" && -s "$MANIFEST" ]] || fail 'schema.sql/manifests.json missing or empty'
command -v jq >/dev/null || fail 'jq is required'
jq -e '.manifest_version == 2 and (.manifest_source_counts | type == "object")' "$MANIFEST" >/dev/null || fail 'manifest version/count metadata invalid'
keys=(
  database_grants large_object_grants tablespace_grants parameter_grants schemas
  tables_and_columns constraints indexes rls policies schema_grants sequence_grants
  function_grants role_attributes role_memberships table_grants column_grants
  default_privileges extensions functions triggers sequences storage_buckets
  storage_object_policies
)
for key in "${keys[@]}"; do
  jq -e --arg k "$key" '
    (.[$k] | type == "array")
    and (.manifest_source_counts[$k] | type == "number")
    and ((.[$k] | length) == .manifest_source_counts[$k])
  ' "$MANIFEST" >/dev/null || fail "manifest section missing, inaccessible, or count-mismatched: $key"
done
jq -e '.schemas | sort == ["private","public","storage"]' "$MANIFEST" >/dev/null || fail 'required schema inventory incomplete'
jq -e '.tables_and_columns | length > 0' "$MANIFEST" >/dev/null || fail 'no columns in manifest'
jq -e '. as $m | ($m.role_attributes | length > 0) and ($m.role_attributes | any(.role == $m.export_role))' "$MANIFEST" >/dev/null || fail 'connected role missing from role_attributes'
jq -e '(.tables_and_columns | any(.schema == "public" and .table == "products" and .column == "id")) and (.tables_and_columns | any(.schema == "public" and .table == "Products" and .column == "id"))' "$MANIFEST" >/dev/null || fail 'required product columns missing from manifest'
jq -e '.product_case_check.lower_exists == true and .product_case_check.upper_exists == true and .product_case_check.distinct == true' "$MANIFEST" >/dev/null || fail 'public.products and public."Products" are not both present as distinct relations'
grep -Eq 'CREATE TABLE[[:space:]]+public\.products([[:space:]]|\()' "$SCHEMA" || fail 'public.products missing from dump'
grep -Eq 'CREATE TABLE[[:space:]]+public\."Products"([[:space:]]|\()' "$SCHEMA" || fail 'public."Products" missing from dump'
if grep -Eiq '^[[:space:]]*(COPY[[:space:]]|INSERT[[:space:]]+INTO[[:space:]])' "$SCHEMA"; then fail 'data statement detected'; fi
if grep -Eiq 'CREATE TABLE[[:space:]]+(auth|storage)\.' "$SCHEMA"; then fail 'Auth/Storage managed tables unexpectedly included'; fi
if grep -Eiq '(postgres(ql)?://[^[:space:]]+|service_role|sb_secret_|BEGIN (OPENSSH|AGE|PGP) PRIVATE KEY|SUPABASE_DB_URL=|password[[:space:]]*[:=])' "$SCHEMA" "$MANIFEST"; then fail 'secret-like string detected'; fi
echo 'Schema and metadata validation passed.'
