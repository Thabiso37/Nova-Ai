#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
if [[ "$#" -lt 2 || "$#" -gt 3 ]]; then echo "Usage: export-consistent.sh <connection-string> <output-directory> [manifest-sql]" >&2; exit 2; fi
CONNECTION_STRING="$1"
OUTPUT_DIR="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST_SQL="${3:-$SCRIPT_DIR/export-manifests.sql}"
MAX_ATTEMPTS="${SCHEMA_EXPORT_MAX_ATTEMPTS:-3}"
[[ -n "$CONNECTION_STRING" && -n "$OUTPUT_DIR" && -s "$MANIFEST_SQL" ]]
[[ "$MAX_ATTEMPTS" =~ ^[1-5]$ ]] || { echo "SCHEMA_EXPORT_MAX_ATTEMPTS must be 1..5" >&2; exit 2; }
pg_dump --version | grep -Eq '^pg_dump \(PostgreSQL\) 17\.11([[:space:]]|$)'
psql --version | grep -Eq '^psql \(PostgreSQL\) 17\.11([[:space:]]|$)'
mkdir -p -m 700 "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"
SCHEMA_OUT="$OUTPUT_DIR/schema.sql"
MANIFEST_OUT="$OUTPUT_DIR/manifests.json"
rm -f -- "$SCHEMA_OUT" "$MANIFEST_OUT"
COORD_PID=""; COORD_IN=""; COORD_OUT=""; ACTIVE_STAGE=""; SUCCESS=0
close_coordinator() {
  local status=0
  if [[ -n "$COORD_PID" ]]; then
    printf 'ROLLBACK;\n\\q\n' >&"$COORD_IN" 2>/dev/null || true
    eval "exec ${COORD_IN}>&-" 2>/dev/null || true
    eval "exec ${COORD_OUT}<&-" 2>/dev/null || true
    wait "$COORD_PID" || status=$?
    COORD_PID=""; COORD_IN=""; COORD_OUT=""
    unset SNAPSHOT_COORD SNAPSHOT_COORD_PID 2>/dev/null || true
  fi
  return "$status"
}
cleanup() {
  close_coordinator || true
  [[ -z "$ACTIVE_STAGE" ]] || rm -rf -- "$ACTIVE_STAGE"
  if [[ "$SUCCESS" -ne 1 ]]; then rm -f -- "$SCHEMA_OUT" "$MANIFEST_OUT"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  ACTIVE_STAGE="$(mktemp -d "$OUTPUT_DIR/.snapshot-attempt.XXXXXXXX")"
  chmod 700 "$ACTIVE_STAGE"
  SCHEMA_STAGE="$ACTIVE_STAGE/schema.sql"
  MANIFEST_STAGE="$ACTIVE_STAGE/manifests.json"
  TXN_SQL="$ACTIVE_STAGE/manifest-transaction.sql"
  coproc SNAPSHOT_COORD { PGCONNECT_TIMEOUT=10 psql "$CONNECTION_STRING" -X -qAt -v ON_ERROR_STOP=1; }
  COORD_PID="$SNAPSHOT_COORD_PID"
  COORD_IN="${SNAPSHOT_COORD[1]}"
  COORD_OUT="${SNAPSHOT_COORD[0]}"
  if ! printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n' >&"$COORD_IN"; then
    echo "Snapshot coordinator failed to begin (attempt $attempt)." >&2
    close_coordinator || true
    rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
    continue
  fi
  SNAPSHOT_ID=""
  if ! IFS= read -r -t 30 SNAPSHOT_ID <&"$COORD_OUT" || [[ ! "$SNAPSHOT_ID" =~ ^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9A-Fa-f]+$ ]]; then
    echo "Snapshot coordinator did not return a valid exported snapshot (attempt $attempt)." >&2
    close_coordinator || true
    rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
    continue
  fi
  if ! bash "$SCRIPT_DIR/dump-schema.sh" "$CONNECTION_STRING" "$SCHEMA_STAGE" "$SNAPSHOT_ID"; then
    echo "Schema dump failed for shared snapshot (attempt $attempt)." >&2
    close_coordinator || true
    rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
    continue
  fi
  {
    printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'
    printf '%s\n' "SET TRANSACTION SNAPSHOT :'snapshot';"
    cat "$MANIFEST_SQL"
    printf '\n%s\n' 'COMMIT;'
  } > "$TXN_SQL"
  if ! psql "$CONNECTION_STRING" -X -qAt -v ON_ERROR_STOP=1 -v snapshot="$SNAPSHOT_ID" -f "$TXN_SQL" -o "$MANIFEST_STAGE"; then
    echo "Manifest generation failed for shared snapshot (attempt $attempt)." >&2
    close_coordinator || true
    rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
    continue
  fi
  if [[ ! -s "$SCHEMA_STAGE" || ! -s "$MANIFEST_STAGE" ]]; then
    echo "One or both shared-snapshot outputs are empty (attempt $attempt)." >&2
    close_coordinator || true
    rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
    continue
  fi
  if ! close_coordinator; then
    echo "Snapshot coordinator did not close cleanly (attempt $attempt)." >&2
    rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
    continue
  fi
  if ! mv -- "$SCHEMA_STAGE" "$SCHEMA_OUT" || ! mv -- "$MANIFEST_STAGE" "$MANIFEST_OUT"; then
    rm -f -- "$SCHEMA_OUT" "$MANIFEST_OUT"
    echo "Could not publish complete snapshot pair (attempt $attempt)." >&2
    rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
    continue
  fi
  rm -rf -- "$ACTIVE_STAGE"; ACTIVE_STAGE=""
  SUCCESS=1
  echo "Consistent schema and manifest exports completed from one PostgreSQL snapshot."
  exit 0
done
echo "Consistent schema export failed after $MAX_ATTEMPTS fresh-snapshot attempt(s); no outputs retained." >&2
exit 1
