#!/bin/sh
set -euo pipefail

# Only disposable test databases are accepted. Never run this against production.
: "${DATABASE_URL:?Set DATABASE_URL to the disposable test database}"
case "$DATABASE_URL" in
  */xiaohai_test) ;;
  *) echo 'Refusing backup drill outside xiaohai_test' >&2; exit 2 ;;
esac
for tool in pg_dump pg_restore psql; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 2; }; done

base_url="${DATABASE_URL%/*}"
admin_url="$base_url/postgres"
verification_name="xiaohai_restore_$(date +%s)_$$"
restore_url="$base_url/$verification_name"
archive="$(mktemp)"
cleanup() {
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$verification_name\" WITH (FORCE)" >/dev/null || true
  rm -f "$archive"
}
trap cleanup EXIT

# The drill must run after writers have stopped. The archive stays local and is removed on exit.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE TABLE IF NOT EXISTS m23_restore_probe (id integer PRIMARY KEY, marker text NOT NULL)' >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO m23_restore_probe VALUES (1, 'restore-probe') ON CONFLICT (id) DO UPDATE SET marker = EXCLUDED.marker" >/dev/null
pg_dump --format=custom --no-owner --no-acl --file="$archive" "$DATABASE_URL"
psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$verification_name\"" >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname="$restore_url" "$archive"

query="SELECT jsonb_build_object(
  'probe', (SELECT count(*) FROM m23_restore_probe WHERE marker = 'restore-probe'),
  'schema', (SELECT count(*) FROM drizzle.__drizzle_migrations),
  'staff', (SELECT count(*) FROM staff_accounts),
  'payments', (SELECT count(*) FROM payments),
  'refunds', (SELECT count(*) FROM refunds),
  'callbacks', (SELECT count(*) FROM payment_callbacks),
  'finance', (SELECT count(*) FROM finance_ledger_entries),
  'finance_amount', (SELECT coalesce(sum(cash_delta_minor),0) FROM finance_ledger_entries),
  'inventory', (SELECT count(*) FROM store_inventory),
  'inventory_quantity', (SELECT coalesce(sum(on_hand),0) FROM store_inventory),
  'inventory_events', (SELECT count(*) FROM inventory_transactions),
  'ai_jobs', (SELECT count(*) FROM ai_jobs),
  'works', (SELECT count(*) FROM works)
)::text"
source_result="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$query")"
restore_result="$(psql "$restore_url" -X -A -t -v ON_ERROR_STOP=1 -c "$query")"
if [ "$source_result" != "$restore_result" ]; then
  echo 'Restore reconciliation failed: source and restored critical totals differ' >&2
  exit 1
fi
echo "Restore verified for $verification_name: $restore_result"
