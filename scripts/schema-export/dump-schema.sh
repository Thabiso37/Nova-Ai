#!/usr/bin/env bash
# Shared production/test entry point: direct PostgreSQL 17.11 schema-only export.
set -Eeuo pipefail
umask 077

if [[ "$#" -ne 2 ]]; then
  echo "Usage: dump-schema.sh <connection-string> <output-file>" >&2
  exit 2
fi

CONNECTION_STRING="$1"
OUTPUT_FILE="$2"
[[ -n "$CONNECTION_STRING" && -n "$OUTPUT_FILE" ]]
pg_dump --version | grep -Eq '^pg_dump \(PostgreSQL\) 17\.11([[:space:]]|$)'

# Never leave a partial dump behind if pg_dump or its postcondition fails.
rm -f -- "$OUTPUT_FILE"
if ! pg_dump --no-password --schema-only --schema=public --schema=private --strict-names --file="$OUTPUT_FILE" "$CONNECTION_STRING"; then
  rm -f -- "$OUTPUT_FILE"
  exit 1
fi
if [[ ! -s "$OUTPUT_FILE" ]]; then
  rm -f -- "$OUTPUT_FILE"
  echo "Schema export failed: pg_dump produced no output." >&2
  exit 1
fi
