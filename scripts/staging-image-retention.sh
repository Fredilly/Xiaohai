#!/usr/bin/env bash
# Reference-safe Xiaohai image retention. Dry-run is the default.
# Live deletion is NOT wired into Actions; it requires separate owner approval.
set -euo pipefail

mode="${1:---dry-run}"
[[ "$mode" == --dry-run || "$mode" == --execute ]] || { echo 'STOP invalid retention mode' >&2; exit 2; }
fail() { printf 'STOP retention: %s\n' "$*" >&2; exit 1; }
valid_revision() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

current="${STAGING_CURRENT_REVISION:-}"
valid_revision "$current" || fail 'missing/invalid current revision'
read -r rollback_a rollback_b extra <<< "${STAGING_ROLLBACK_REVISIONS:-}"
valid_revision "${rollback_a:-}" && valid_revision "${rollback_b:-}" || fail 'two verified rollback revisions required'
[[ -z "${extra:-}" && "$current" != "$rollback_a" && "$current" != "$rollback_b" && "$rollback_a" != "$rollback_b" ]] || fail 'rollback mapping must have exactly two distinct older revisions'

if [[ "$mode" == --execute ]]; then
  [[ "${STAGING_RETENTION_EXECUTE_ENABLED:-false}" == true ]] || fail 'execution not authorized; use dry-run'
  [[ "${STAGING_DEPLOY_SUCCEEDED_REVISION:-}" == "$current" ]] || fail 'verified successful deployment revision is required'
  [[ -f "${STAGING_RETENTION_APPROVED_PLAN:-/nonexistent}" ]] || fail 'preapproved exact-ID plan required'
  [[ -n "${STAGING_RETENTION_APPROVAL_ID:-}" ]] || fail 'owner approval reference required'
  [[ -n "${STAGING_EXPECTED_HOSTNAME:-}" && "$(hostname)" == "$STAGING_EXPECTED_HOSTNAME" ]] || fail 'staging host identity unavailable'
fi

# Shared with staging deployment. Never remove images while deployment holds this lock.
lock="${STAGING_DEPLOY_LOCK:-/tmp/xiaohai-staging-deploy.lock}"
command -v flock >/dev/null || fail 'flock unavailable'
exec 9>"$lock"
flock -n 9 || fail 'deployment/retention operation already running'
[[ "$(docker context show)" == default ]] || fail 'unexpected Docker context'

api_repo='ghcr.io/fredilly/xiaohai-api'
worker_repo='ghcr.io/fredilly/xiaohai-worker'
declare -A protected_ids=()
for rev in "$current" "$rollback_a" "$rollback_b"; do
  for repo in "$api_repo" "$worker_repo"; do
    id=$(docker image inspect --format '{{.Id}}' "$repo:$rev") || fail "protected image missing: $repo:$rev"
    [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid protected image ID'
    protected_ids["$id"]=1
  done
done

for image in postgres:17-alpine redis:7.4-alpine caddy:2-alpine; do
  id=$(docker image inspect --format '{{.Id}}' "$image") || fail "protected infrastructure image missing: $image"
  protected_ids["$id"]=1
done
# Preserve every unknown/untagged image; the referenced image ID must remain protected.
protected_ids['sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb']=1

if [[ "$mode" == --execute ]]; then
  for volume in xiaohai-staging_postgres_data xiaohai-staging_redis_data xiaohai-staging_caddy_data xiaohai-staging_caddy_config; do
    docker volume inspect "$volume" >/dev/null || fail "protected volume unavailable: $volume"
  done
  for service in api worker; do
    ref="ghcr.io/fredilly/xiaohai-$service:$current"
    [[ "$(docker inspect --format '{{.Config.Image}}' "xiaohai-staging-$service-1")" == "$ref" ]] || fail "running $service revision changed"
  done
fi

# Collect ALL container references including stopped containers; refresh before every removal.
refresh_refs() {
  local container_ids cid image_id image_tag
  container_ids=$(docker ps -aq --no-trunc) || fail 'cannot enumerate containers'
  refs=''
  while IFS= read -r cid; do
    [[ -n "$cid" ]] || continue
    image_id=$(docker inspect --format '{{.Image}}' "$cid") || fail 'cannot inspect container image ID'
    image_tag=$(docker inspect --format '{{.Config.Image}}' "$cid") || fail 'cannot inspect container image tag'
    refs+="${image_id}|${image_tag}"$'\n'
  done <<< "$container_ids"
}
refresh_refs

is_referenced() {
  local expected_id="$1" expected_tag="$2" line
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" != "$expected_id|"* && "$line" != *"|$expected_tag" ]] || return 0
  done <<< "$refs"
  return 1
}

# Only 40-hex SHA-tagged API/Worker images qualify. Ignore <none>, infra and unknown repos.
image_list=$(docker image ls -a --no-trunc --format '{{.Repository}}:{{.Tag}}') || fail 'cannot list images'
declare -A revisions=()
while IFS= read -r ref; do
  if [[ "$ref" =~ ^ghcr\.io/fredilly/xiaohai-(api|worker):([0-9a-f]{40})$ ]]; then
    revisions["${BASH_REMATCH[2]}"]=1
  fi
done <<< "$image_list"

check_candidate() {
  local ref="$1" id aliases
  id=$(docker image inspect --format '{{.Id}}' "$ref") || return 1
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [[ -z "${protected_ids[$id]:-}" ]] || return 1
  is_referenced "$id" "$ref" && return 1
  aliases=$(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$ref") || return 1
  # An image with another tag could be a shared/retained rollback artifact.
  [[ "$aliases" == "$ref" ]] || return 1
  REPLY="$id"
}

check_config() {
  local rev="$1" matches status
  if matches=$(grep -RIlF --include='*.env' --include='*.yml' --include='*.yaml' --include='*.sh' \
    -- "$rev" /opt /home /etc/systemd/system 2>/dev/null); then
    return 1 # A deployment reference: protect.
  else
    status=$?
    [[ "$status" -eq 1 ]] || fail 'deployment configuration scan failed'
  fi
}

capacity() {
  local data
  data=$(df -Pk /) || fail 'cannot read available disk'
  read -r FREE_KIB USED_PCT < <(printf '%s\n' "$data" | awk 'NR==2 {gsub(/%/, "", $5); print $4,$5}')
  [[ "$FREE_KIB" =~ ^[0-9]+$ && "$USED_PCT" =~ ^[0-9]+$ ]] || fail 'invalid df output'
}

healthy() {
  [[ "$(docker inspect --format '{{.State.Health.Status}}' xiaohai-staging-postgres-1)" == healthy ]] || fail 'PostgreSQL unhealthy'
  local redis status
  redis=$(docker exec xiaohai-staging-redis-1 redis-cli INFO persistence | tr -d '\r') || fail 'Redis persistence read failed'
  printf '%s\n' "$redis" | grep -qx 'rdb_last_bgsave_status:ok' || fail 'Redis RDB unhealthy'
  printf '%s\n' "$redis" | grep -qx 'aof_last_write_status:ok' || fail 'Redis AOF unhealthy'
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://staging-api.pamboo.asia/ready) || fail 'API readiness probe unavailable'
  [[ "$status" == 200 ]] || fail 'API readiness non-200'
}

if [[ "$mode" == --execute ]]; then healthy; fi

count=0
while IFS= read -r rev; do
  [[ -n "$rev" ]] || continue
  [[ "$rev" != "$current" && "$rev" != "$rollback_a" && "$rev" != "$rollback_b" ]] || continue
  api="$api_repo:$rev"
  worker="$worker_repo:$rev"
  # Never remove a half-release or images with references/aliases/unknown IDs.
  refresh_refs
  check_candidate "$api" || { printf 'SKIP revision=%s reason=api_unverifiable_or_referenced\n' "$rev"; continue; }
  api_id="$REPLY"
  check_candidate "$worker" || { printf 'SKIP revision=%s reason=worker_unverifiable_or_referenced\n' "$rev"; continue; }
  worker_id="$REPLY"
  check_config "$rev" || { printf 'SKIP revision=%s reason=deployment_config_reference\n' "$rev"; continue; }
  printf 'AUDIT mode=%s revision=%s api=%s api_id=%s worker=%s worker_id=%s\n' \
    "$mode" "$rev" "$api" "$api_id" "$worker" "$worker_id"
  [[ "$mode" == --execute ]] || continue

  capacity
  if (( FREE_KIB >= 15728640 || USED_PCT <= 70 )); then
    echo 'STOP target reached; no more deletions'
    break
  fi
  before="$FREE_KIB"
  approved=$(grep -Fx -- "$rev $api_id $worker_id" "$STAGING_RETENTION_APPROVED_PLAN") || fail 'approved plan does not match current exact image IDs'
  [[ "$approved" == "$rev $api_id $worker_id" ]] || fail 'ambiguous approved plan'
  healthy
  # Re-evaluate all references before each deletion; never force or prune.
  for entry in "$api|$api_id" "$worker|$worker_id"; do
    ref="${entry%%|*}"
    expected="${entry#*|}"
    refresh_refs
    check_config "$rev" || fail "deployment reference changed: $rev"
    check_candidate "$ref" || fail "candidate changed: $ref"
    [[ "$REPLY" == "$expected" ]] || fail "image ID changed: $ref"
    docker image rm "$ref" || fail "Docker refused deletion: $ref"
  done
  capacity
  (( FREE_KIB > before )) || fail 'no net filesystem space reclaimed'
  healthy
  printf 'AUDIT deleted_revision=%s before_kib=%s after_kib=%s used_pct=%s\n' "$rev" "$before" "$FREE_KIB" "$USED_PCT"
  count=$((count + 1))
  if (( count >= 2 )); then
    echo 'STOP batch maximum 2 revision pairs reached'
    break
  fi
done < <(printf '%s\n' "${!revisions[@]}" | sort)

echo "RETENTION COMPLETE mode=$mode deleted_pairs=$count"
