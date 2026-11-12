#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'STOP retention executor: %s\n' "$*" >&2
  exit 1
}

[[ "$#" -eq 2 ]] || fail 'expected params and plan paths'
params="$1"
plan="$2"

[[ "$params" =~ ^/tmp/xiaohai-retention-params-[0-9]+-[0-9]+\.txt$ ]] ||
  fail 'unsafe params path'
[[ "$plan" =~ ^/tmp/xiaohai-retention-plan-[0-9]+-[0-9]+\.txt$ ]] ||
  fail 'unsafe plan path'
[[ -f "$params" && ! -L "$params" ]] || fail 'params unavailable'
[[ -f "$plan" && ! -L "$plan" ]] || fail 'exact plan unavailable'

cleanup() {
  rm -f -- "$params" "$plan"
}
trap cleanup EXIT

mapfile -t values < "$params"
[[ "${#values[@]}" -eq 12 ]] || fail 'invalid parameter record count'

REVISION="${values[0]}"
ROLLBACKS="${values[1]}"
EXTRA_PROTECTED="${values[2]}"
CONFIG_COVERAGE="${values[3]}"
EXPECTED_HOSTNAME="${values[4]}"
EXPECTED_SCRIPT_BLOB="${values[5]}"
APPROVAL_ID="${values[6]}"
POLICY_ID="${values[7]}"
PLAN_SHA256="${values[8]}"
EXPECTED_NORMALIZED_PLAN_SHA256="${values[9]}"
SOURCE_RUN_ID="${values[10]}"
DISPATCH_ACTOR="${values[11]}"

[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid revision'
[[ "$ROLLBACKS" =~ ^[0-9a-f]{40}[[:space:]][0-9a-f]{40}$ ]] || fail 'invalid rollback set'
[[ "$EXTRA_PROTECTED" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid extra protected revision'
[[ "$CONFIG_COVERAGE" == true ]] || fail 'config coverage not confirmed'
[[ "$EXPECTED_HOSTNAME" =~ ^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,252}[A-Za-z0-9])?$ ]] ||
  fail 'invalid expected hostname'
[[ "$EXPECTED_SCRIPT_BLOB" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid reviewed script blob'
[[ "$APPROVAL_ID" =~ ^XIAOHAI-195-STEADY-[A-Za-z0-9-]{1,80}$ ]] || fail 'invalid approval ID'
[[ "$POLICY_ID" =~ ^XIAOHAI-195-RETENTION-[A-Za-z0-9-]{1,72}$ ]] || fail 'invalid policy ID'
[[ "$PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid reviewed proposal hash'
[[ "$EXPECTED_NORMALIZED_PLAN_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid normalized plan hash'
[[ "$SOURCE_RUN_ID" =~ ^[1-9][0-9]*$ ]] || fail 'invalid source run ID'
[[ "$DISPATCH_ACTOR" =~ ^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$ ]] || fail 'invalid dispatch actor'

[[ "$(hostname)" == "$EXPECTED_HOSTNAME" ]] || fail 'hostname mismatch'

script="$HOME/xiaohai-deploy/staging-image-retention.sh"
[[ -f "$script" && ! -L "$script" ]] || fail 'reviewed host script unavailable'
[[ "$(git hash-object "$script")" == "$EXPECTED_SCRIPT_BLOB" ]] ||
  fail 'host script hash differs from exact deployed revision'
bash -n "$script"

remote_plan_sha="$(sha256sum "$plan" | awk '{print $1}')"
[[ "$remote_plan_sha" == "$EXPECTED_NORMALIZED_PLAN_SHA256" ]] ||
  fail 'uploaded normalized plan hash mismatch'

receipt_root="$HOME/xiaohai-deploy/.retention-authorizations"
mkdir -p "$receipt_root"
chmod 0700 "$receipt_root"
receipt_dir="$receipt_root/$APPROVAL_ID"

# mkdir is the atomic consume operation. Exactly one concurrent dispatcher can win.
if ! mkdir -m 0700 "$receipt_dir" 2>/dev/null; then
  fail 'approval ID already consumed'
fi
receipt="$receipt_dir/receipt.txt"
umask 077
{
  printf 'approval_id=%s\n' "$APPROVAL_ID"
  printf 'policy_id=%s\n' "$POLICY_ID"
  printf 'revision=%s\n' "$REVISION"
  printf 'source_run_id=%s\n' "$SOURCE_RUN_ID"
  printf 'reviewed_plan_sha256=%s\n' "$PLAN_SHA256"
  printf 'normalized_plan_sha256=%s\n' "$EXPECTED_NORMALIZED_PLAN_SHA256"
  printf 'dispatch_actor=%s\n' "$DISPATCH_ACTOR"
  printf 'consumed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$receipt"

set +e
STAGING_CURRENT_REVISION="$REVISION" STAGING_ROLLBACK_REVISIONS="$ROLLBACKS" STAGING_EXTRA_PROTECTED_REVISION="$EXTRA_PROTECTED" STAGING_CONFIG_COVERAGE_CONFIRMED="$CONFIG_COVERAGE" STAGING_RETENTION_EXECUTE_ENABLED=true STAGING_DEPLOY_SUCCEEDED_REVISION="$REVISION" STAGING_RETENTION_APPROVED_PLAN="$plan" STAGING_RETENTION_APPROVAL_ID="$APPROVAL_ID" STAGING_EXPECTED_HOSTNAME="$EXPECTED_HOSTNAME" bash "$script" --steady-state-execute
status=$?
set -e

{
  printf 'execution_status=%s\n' "$status"
  printf 'completed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >> "$receipt"

printf 'RETENTION_EXECUTOR_STATUS=%s\n' "$status"
echo 'RETENTION_EXECUTOR_NO_RETRY=true'
exit "$status"
