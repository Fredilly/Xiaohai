#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=staging-pg-diagnostic-restore.sh
source "$script_dir/staging-pg-diagnostic-restore.sh"

test_dir=$(mktemp -d "${TMPDIR:-/tmp}/xiaohai-restore-test.XXXXXX")
trap 'find "$test_dir" -type f -delete 2>/dev/null || true; rmdir "$test_dir" 2>/dev/null || true' EXIT

error_log="$test_dir/error.log"
run_restore_command bash -c 'exit 0'
test "$restore_rc" -eq 0
run_restore_command bash -c 'printf "permission denied SQL state: 42501\n" >&2; exit 7' || true
test "$restore_rc" -eq 7
test "$(classify_error_log "$error_log")" = PERMISSION
test "$(extract_sqlstate "$error_log")" = 42501
test "$(grep -F 'permission denied' "$error_log" | wc -l | tr -d ' ')" = 1
grep -F -- 'pg_restore -U restorecheck' "$script_dir/staging-pg-diagnostic-restore.sh" >/dev/null

# Cleanup only removes resources owned by this run.
work_dir="$test_dir/work"
host_key_file="$test_dir/host-key"
mkdir "$work_dir"
touch "$work_dir/owned" "$host_key_file"
sentinel="$test_dir/not-owned"
touch "$sentinel"
container_name=xiaohai-test-never-created
created_container=0
cleanup_done=0
cleanup_failed=0
cleanup_resources 0
test ! -e "$work_dir"
test ! -e "$host_key_file"
test -e "$sentinel"

# A failed removal must be observable and cannot be reported as PASS.
mock_docker="$test_dir/docker"
cat >"$mock_docker" <<'MOCK'
#!/usr/bin/env bash
if [[ $1 == ps ]]; then printf '%s\n' "$MOCK_CONTAINER"; fi
MOCK
chmod 700 "$mock_docker"
DOCKER_BIN="$mock_docker"
export MOCK_CONTAINER=xiaohai-test-created
work_dir="$test_dir/failing-cleanup"
host_key_file=''
mkdir "$work_dir"
container_name="$MOCK_CONTAINER"
created_container=1
cleanup_done=0
cleanup_failed=0
set +e
cleanup_resources 0
cleanup_rc=$?
set -e
test "$cleanup_rc" -ne 0
test "$cleanup_failed" -eq 1
test ! -e "$work_dir"
DOCKER_BIN=docker

# A signal trap must clean a child run's owned directory before exiting.
signal_probe="$test_dir/signal-probe"
mkdir "$signal_probe"
bash -c "source '$script_dir/staging-pg-diagnostic-restore.sh'; work_dir='$signal_probe'; host_key_file=''; container_name='unused'; created_container=0; cleanup_done=0; trap 'cleanup_resources \"\$?\"' EXIT; trap on_signal TERM; kill -TERM \"\$\$\"" >/dev/null 2>&1 || true
test ! -e "$signal_probe"

echo 'staging-pg-diagnostic-restore simulation: PASS'
