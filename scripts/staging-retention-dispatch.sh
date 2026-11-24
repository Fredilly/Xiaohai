#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'RETENTION_DISPATCH_STOP: %s\n' "$*" >&2
  exit 1
}

[[ "$#" -eq 2 ]] || fail 'expected local params and plan paths'
params="$1"
plan="$2"

[[ -f "$params" && ! -L "$params" ]] || fail 'local params unavailable'
[[ -f "$plan" && ! -L "$plan" ]] || fail 'local plan unavailable'
[[ "${HOST:-}" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'unsafe SSH host'
[[ "${USER:-}" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'unsafe SSH user'
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] || fail 'invalid GitHub run ID'
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]] || fail 'invalid GitHub run attempt'

remote_params="/tmp/xiaohai-retention-params-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.txt"
remote_plan="/tmp/xiaohai-retention-plan-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.txt"

scp "$params" "$USER@$HOST:$remote_params"
scp "$plan" "$USER@$HOST:$remote_plan"

# Only generated numeric temp paths are interpolated into the remote command.
# Owner/user inputs travel inside the params file and are parsed/validated remotely.
ssh "$USER@$HOST" "bash -s -- '$remote_params' '$remote_plan'" <   scripts/staging-retention-remote-executor.sh
