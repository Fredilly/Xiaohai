#!/usr/bin/env bash
set -Eeuo pipefail

# One-shot, read-only Staging logical-backup restore drill. It never writes a
# backup on ECS and only creates a disposable local container/tmpfs.
ECS_HOST=${ECS_HOST:-47.238.143.29}
ECS_USER=${ECS_USER:-admin}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/xiaohai-production-admin-20261125}
EXPECTED_HOST_FINGERPRINT=${EXPECTED_HOST_FINGERPRINT:-SHA256:xR/bOWlaBm8koU6AGZjwdDFnHIaDTXQ04oHzVwA1HNo}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17-alpine}
MIN_FREE_BYTES=${MIN_FREE_BYTES:-5368709120}
SSH_BIN=${SSH_BIN:-ssh}
KEYSCAN_BIN=${KEYSCAN_BIN:-ssh-keyscan}
KEYGEN_BIN=${KEYGEN_BIN:-ssh-keygen}
DOCKER_BIN=${DOCKER_BIN:-docker}
FILE_BIN=${FILE_BIN:-file}
SHASUM_BIN=${SHASUM_BIN:-shasum}

restore_rc=0
cleanup_failed=0
cleanup_done=0
created_container=0
work_dir=''
host_key_file=''
container_name=''
error_log=''

classify_error_log() {
  local log=$1
  if grep -Eiq 'no space left|disk full|could not extend|out of space' "$log"; then
    printf '%s\n' CAPACITY
  elif grep -Eiq 'permission denied|must be owner|role .* does not exist|insufficient privilege' "$log"; then
    printf '%s\n' PERMISSION
  elif grep -Eiq 'already exists|duplicate|conflict' "$log"; then
    printf '%s\n' OBJECT_CONFLICT
  elif grep -Eiq 'extension .* does not exist|could not open extension|unpackaged version' "$log"; then
    printf '%s\n' EXTENSION
  elif grep -Eiq 'unsupported version|not a valid archive|input file is too short|invalid archive' "$log"; then
    printf '%s\n' ARCHIVE
  else
    printf '%s\n' UNKNOWN
  fi
}

extract_sqlstate() {
  local log=$1 match
  match=$(grep -Eio 'SQL[[:space:]_-]*state[=:[:space:]]+[0-9A-Z]{5}' "$log" | head -n 1 || true)
  if [[ -n $match ]]; then
    printf '%s\n' "$match" | grep -Eo '[0-9A-Z]{5}' | tail -n 1
  else
    printf '%s\n' none
  fi
}

run_restore_command() {
  set +e
  "$@" >"$error_log" 2>&1
  restore_rc=$?
  set -e
  return "$restore_rc"
}

cleanup_resources() {
  local final_rc=${1:-0}
  if ((cleanup_done)); then return "$final_rc"; fi
  trap - EXIT INT TERM
  if ((created_container)); then
    "$DOCKER_BIN" rm -f "$container_name" >/dev/null 2>&1 || true
    if "$DOCKER_BIN" ps -a --format '{{.Names}}' | grep -Fx "$container_name" >/dev/null 2>&1; then
      cleanup_failed=1
    fi
  fi
  if [[ -n $work_dir && -d $work_dir ]]; then
    find "$work_dir" -type f -delete 2>/dev/null || cleanup_failed=1
    rmdir "$work_dir" 2>/dev/null || cleanup_failed=1
  fi
  if [[ -n $host_key_file && -e $host_key_file ]]; then
    unlink "$host_key_file" 2>/dev/null || cleanup_failed=1
  fi
  [[ -z $work_dir || ! -e $work_dir ]] || cleanup_failed=1
  [[ -z $host_key_file || ! -e $host_key_file ]] || cleanup_failed=1
  cleanup_done=1
  if ((cleanup_failed)); then
    printf '%s\n' 'CLEANUP=FAIL' >&2
    ((final_rc == 0)) && final_rc=1
  else
    printf '%s\n' 'CLEANUP=PASS'
  fi
  return "$final_rc"
}

on_signal() { restore_rc=130; exit 130; }

main() {
  local fp health hcode rcode bytes sha format pgver tmpfs object_entries structure
  local category sqlstate error_lines vol_before vol_after
  local ssh_args remote_dump final_host_key final_fp
  work_dir=$(mktemp -d "${TMPDIR:-/tmp}/xiaohai-staging-diagnostic.XXXXXX")
  chmod 700 "$work_dir"
  host_key_file=$(mktemp "${TMPDIR:-/tmp}/xiaohai-known-hosts.XXXXXX")
  container_name="xiaohai-staging-diagnostic-$(date +%s)-$$"
  error_log="$work_dir/restore.log"
  trap 'cleanup_resources "$?"' EXIT
  trap on_signal INT TERM

  "$KEYSCAN_BIN" -T 10 -t ed25519 "$ECS_HOST" >"$host_key_file" 2>/dev/null
  fp=$("$KEYGEN_BIN" -lf "$host_key_file" -E sha256 | awk '{print $2}')
  printf 'HOST_FINGERPRINT=%s\n' "$fp"
  [[ $fp == "$EXPECTED_HOST_FINGERPRINT" ]] || { echo 'HOST_FINGERPRINT_MISMATCH' >&2; return 1; }
  echo 'HOST_FINGERPRINT_MATCH=PASS'

  ssh_args=(-T -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$host_key_file" -i "$SSH_KEY")
  run_ssh() { "$SSH_BIN" "${ssh_args[@]}" "$ECS_USER@$ECS_HOST" "$@"; }
  health=$(run_ssh "docker inspect --format '{{.State.Health.Status}}' xiaohai-staging-postgres-1")
  hcode=$(run_ssh "curl -kLsS -o /dev/null -w '%{http_code}' --max-time 10 https://staging-api.pamboo.asia/health")
  rcode=$(run_ssh "curl -kLsS -o /dev/null -w '%{http_code}' --max-time 10 https://staging-api.pamboo.asia/ready")
  printf 'POSTGRES_HEALTH=%s STAGING_HEALTH=%s STAGING_READY=%s\n' "$health" "$hcode" "$rcode"
  [[ $health == healthy && $hcode == 200 && $rcode == 200 ]] || { echo 'PREFLIGHT=FAIL' >&2; return 1; }

  bytes=$(df -Pk "$work_dir" | awk 'NR==2 {print $4 * 1024}')
  [[ $bytes -ge $MIN_FREE_BYTES ]] || { echo 'MAC_CAPACITY=FAIL' >&2; return 1; }
  remote_dump="docker exec xiaohai-staging-postgres-1 sh -c 'exec pg_dump -Fc -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
  run_ssh "$remote_dump" >"$work_dir/staging.dump" 2>"$work_dir/stream.err"
  chmod 600 "$work_dir/staging.dump" "$work_dir/stream.err"
  bytes=$(stat -f '%z' "$work_dir/staging.dump")
  sha=$("$SHASUM_BIN" -a 256 "$work_dir/staging.dump" | awk '{print $1}')
  format=$("$FILE_BIN" -b "$work_dir/staging.dump")
  printf 'BACKUP_BYTES=%s BACKUP_SHA256=%s\n' "$bytes" "$sha"
  printf 'BACKUP_FORMAT=%s\n' "$format"
  ((bytes > 0)) && printf '%s' "$format" | grep -qi 'PostgreSQL custom database dump' || { echo 'BACKUP=FAIL' >&2; return 1; }

  vol_before=$("$DOCKER_BIN" volume ls -q | sort | "$SHASUM_BIN" -a 256 | awk '{print $1}')
  [[ -z $("$DOCKER_BIN" ps -a --filter "name=^/${container_name}$" --format '{{.Names}}') ]] || { echo 'CONTAINER_NAME_COLLISION' >&2; return 1; }
  "$DOCKER_BIN" run -d --rm --name "$container_name" --network none --tmpfs /var/lib/postgresql/data:rw,size=4g -v "$work_dir:/backup:ro" -e POSTGRES_DB=restorecheck -e POSTGRES_USER=restorecheck -e POSTGRES_PASSWORD=local_restore_only "$POSTGRES_IMAGE" >/dev/null
  created_container=1
  for _ in $(seq 1 45); do
    "$DOCKER_BIN" exec "$container_name" pg_isready -U restorecheck -d restorecheck >/dev/null 2>&1 && break
    sleep 1
  done
  "$DOCKER_BIN" exec "$container_name" pg_isready -U restorecheck -d restorecheck >/dev/null 2>&1 || { echo 'RESTORE=FAIL ROOT=POSTGRES_NOT_READY EXIT=1' >&2; return 1; }
  pgver=$("$DOCKER_BIN" exec "$container_name" pg_restore --version | tr -d '\r')
  tmpfs=$("$DOCKER_BIN" exec "$container_name" sh -c "df -B1 /var/lib/postgresql/data | awk 'NR==2{print \$2}'")
  printf 'PG_RESTORE_CLIENT=%s TMPFS_BYTES=%s\n' "$pgver" "$tmpfs"
  "$DOCKER_BIN" exec "$container_name" createdb -U restorecheck -T template0 diagnostic >/dev/null
  "$DOCKER_BIN" exec "$container_name" pg_restore -U restorecheck --list /backup/staging.dump >"$work_dir/archive.list" 2>"$work_dir/archive.err"
  object_entries=$(wc -l <"$work_dir/archive.list" | tr -d ' ')
  printf 'DUMP_OBJECT_ENTRIES=%s\n' "$object_entries"
  run_restore_command "$DOCKER_BIN" exec "$container_name" pg_restore -U restorecheck --exit-on-error --single-transaction --no-owner --no-acl -d diagnostic /backup/staging.dump || true
  if ((restore_rc != 0)); then
    category=$(classify_error_log "$error_log")
    sqlstate=$(extract_sqlstate "$error_log")
    error_lines=$(grep -Eic 'error|fatal' "$error_log" 2>/dev/null || true)
    printf 'RESTORE=FAIL ROOT=%s SQLSTATE=%s EXIT=%s ERROR_LINES=%s\n' "$category" "$sqlstate" "$restore_rc" "$error_lines"
  else
    structure=$("$DOCKER_BIN" exec "$container_name" psql -U restorecheck -d diagnostic -Atqc "SELECT json_build_object('user_schemas',(SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),'tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')),'migration_table_present',(to_regclass('drizzle.__drizzle_migrations') IS NOT NULL),'migration_rows',CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN -1 ELSE (SELECT count(*) FROM drizzle.__drizzle_migrations) END,'key_tables_present',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('books','inventory_transactions','orders','rental_items','stores')));")
    printf 'RESTORE=PASS STRUCTURE=%s\n' "$structure"
  fi
  vol_after=$("$DOCKER_BIN" volume ls -q | sort | "$SHASUM_BIN" -a 256 | awk '{print $1}')
  [[ $vol_before == "$vol_after" ]] || cleanup_failed=1
  # Verify health while the original strictly checked known_hosts file is still
  # available; cleanup_resources then removes it and all other run-owned files.
  health=$(run_ssh "docker inspect --format '{{.State.Health.Status}}' xiaohai-staging-postgres-1")
  hcode=$(run_ssh "curl -kLsS -o /dev/null -w '%{http_code}' --max-time 10 https://staging-api.pamboo.asia/health")
  rcode=$(run_ssh "curl -kLsS -o /dev/null -w '%{http_code}' --max-time 10 https://staging-api.pamboo.asia/ready")
  printf 'FINAL_PG_HEALTH=%s FINAL_HEALTH=%s FINAL_READY=%s\n' "$health" "$hcode" "$rcode"
  local cleanup_rc
  set +e
  cleanup_resources "$restore_rc"
  cleanup_rc=$?
  set -e
  if ((cleanup_failed)); then return 1; fi
  [[ $cleanup_rc -eq 0 ]] || return "$cleanup_rc"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
