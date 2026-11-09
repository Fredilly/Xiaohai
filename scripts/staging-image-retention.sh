#!/usr/bin/env bash
# Reference-safe Xiaohai image retention. Dry-run is the default.
# Live deletion is NOT wired into Actions; it requires separate owner approval.
set -euo pipefail

mode="${1:---dry-run}"
[[ "$mode" == --dry-run || "$mode" == --plan || "$mode" == --execute || "$mode" == --recovery-execute || "$mode" == --batch2-recovery-execute || "$mode" == --phase-d-recovery-execute || "$mode" == --steady-state-execute ]] || { echo 'STOP invalid retention mode' >&2; exit 2; }
# --recovery-execute is a separate, manually invoked one-time exception for the
# Nov 6 failed-post-disk-gate incident. Never wire it into CI or scheduled jobs.
# It NEVER asserts that the failed historical workflow succeeded.
deleting=false
recovery=false
batch2=false
phase_d=false
planning=false
if [[ "$mode" == --execute || "$mode" == --recovery-execute || "$mode" == --batch2-recovery-execute || "$mode" == --phase-d-recovery-execute || "$mode" == --steady-state-execute ]]; then deleting=true; fi
if [[ "$mode" == --recovery-execute || "$mode" == --batch2-recovery-execute || "$mode" == --phase-d-recovery-execute ]]; then recovery=true; fi
if [[ "$mode" == --batch2-recovery-execute ]]; then batch2=true; fi
if [[ "$mode" == --phase-d-recovery-execute ]]; then phase_d=true; fi
if [[ "$mode" == --plan ]]; then planning=true; fi
fail() { printf 'STOP retention: %s\n' "$*" >&2; exit 1; }
valid_revision() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

current="${STAGING_CURRENT_REVISION:-}"
valid_revision "$current" || fail 'missing/invalid current revision'
read -r rollback_a rollback_b extra <<< "${STAGING_ROLLBACK_REVISIONS:-}"
valid_revision "${rollback_a:-}" && valid_revision "${rollback_b:-}" || fail 'two verified rollback revisions required'
[[ -z "${extra:-}" && "$current" != "$rollback_a" && "$current" != "$rollback_b" && "$rollback_a" != "$rollback_b" ]] || fail 'rollback mapping must have exactly two distinct older revisions'
# During the 2026-11 staging rollout, the previous deployed release must
# also remain protected in addition to the two designated rollback releases.
# Missing identity is ambiguous: fail closed, never assume it may be deleted.
additional="${STAGING_EXTRA_PROTECTED_REVISION:-}"
valid_revision "$additional" || fail 'one additional protected historical revision is required'
[[ "$additional" != "$current" && "$additional" != "$rollback_a" && "$additional" != "$rollback_b" ]] ||
  fail 'additional protected revision must be distinct'
# Owner-required Nov 5 provisional HOLD: protect all five API+Worker release pairs.
# This is a versioned, explicit safety allowlist. No image deletion authorization
# follows from listing a revision here, and Actions remains dry-run-only.
# Fixed incident candidate identities are security policy declarations, not
# references to a deployed release. Check them separately from deployment files.
known_recovery_a=1138ce2734533ae64e37eaccb2a833d9fa847515
known_recovery_b=14d59d3cd209a400f397fdff1880b4f02ab26d54
# Code-only proposal for #195 batch 2. Separate, non-reusable owner approval
# and a reviewed new script installation are required before any live use.
batch2_recovery_a=15bc9dadc32b30f55cbc5cbcb2cc410c1564433e
batch2_recovery_b=3f0e3d0ad16352393cdeaa12e8f8482c9c9fcfeb
phase_d_recovery_a=4a29bc44d34b7f609b223987735507abff68641d
phase_d_recovery_b=4b53315bed756bf5888aa96683454a4add5c7b80
recent_hold_revisions=(
  "03f5ee0f3d364597739162ca8661ebc993523ead"
  "12091f5d8586809ebb5d43308582797d00b3ba79"
  "662ca971de6cae265d810b7e37e74eb1ce836abc"
  "ecaea1f231469903e3eaa9dedad437f37d0d78c5"
  "ecc03badca74669d85f5c7b69915b81967d39825"
)
protected_revisions=()
declare -A protected_revision_set=()
for rev in "$current" "$rollback_a" "$rollback_b" "$additional" "${recent_hold_revisions[@]}"; do
  valid_revision "$rev" || fail 'invalid protected HOLD revision'
  [[ -z "${protected_revision_set[$rev]:-}" ]] || continue
  protected_revision_set["$rev"]=1
  protected_revisions+=("$rev")
done

# Normal --execute and --steady-state-execute require a genuine verified success.
# --steady-state-execute differs only in not stopping when usage drops below
# the emergency threshold: it keeps the daily obsolete-image count bounded.
# It is NOT wired into Actions and retains the explicit exact-ID owner plan.
# The normal --execute route retains its original verified-success requirement.
# Recovery is NOT an alternate way of providing STAGING_DEPLOY_SUCCEEDED_REVISION.
if [[ "$deleting" == true ]]; then
  [[ "${STAGING_RETENTION_EXECUTE_ENABLED:-false}" == true ]] || fail 'execution not authorized; use dry-run'
  [[ -f "${STAGING_RETENTION_APPROVED_PLAN:-/nonexistent}" && ! -L "$STAGING_RETENTION_APPROVED_PLAN" ]] ||
    fail 'preapproved exact-ID plan required'
  [[ -n "${STAGING_RETENTION_APPROVAL_ID:-}" ]] || fail 'owner approval reference required'
  [[ -n "${STAGING_EXPECTED_HOSTNAME:-}" && "$(hostname)" == "$STAGING_EXPECTED_HOSTNAME" ]] || fail 'staging host identity unavailable'
  if [[ "$recovery" == true ]]; then
    [[ "${STAGING_RECOVERY_EXECUTE_ENABLED:-false}" == true ]] || fail 'one-time recovery execution not enabled'
    if [[ "$batch2" == true ]]; then
      [[ "${STAGING_BATCH2_EXECUTE_ENABLED:-false}" == true ]] ||
        fail 'batch 2 requires separate owner execution enablement'
      [[ "$STAGING_RETENTION_APPROVAL_ID" =~ ^XIAOHAI-195-PHASEC-[A-Za-z0-9-]+$ ]] ||
        fail 'batch 2 requires new Phase C owner approval ID; old Phase B approval is invalid'
      [[ "$STAGING_RETENTION_APPROVAL_ID" != XIAOHAI-195-PHASEB-20261106-EXACT4 ]] ||
        fail 'batch 2 cannot reuse Phase B approval'
    elif [[ "$phase_d" == true ]]; then
      [[ "${STAGING_PHASED_EXECUTE_ENABLED:-false}" == true ]] ||
        fail 'Phase D requires separate owner execution enablement'
      [[ "$STAGING_RETENTION_APPROVAL_ID" =~ ^XIAOHAI-195-PHASED-[A-Za-z0-9-]+$ ]] ||
        fail 'Phase D requires distinct Phase D owner approval ID'
    fi
    [[ "$current" == e4c1117e99e1d739b002f99be3b97be7ede89121 ]] ||
      fail 'recovery applies only to the pinned failed-gate revision'
    [[ "${STAGING_RECOVERY_FAILED_RUN_ID:-}" == 41982285823 ]] ||
      fail 'exact failed workflow run must be acknowledged'
    [[ "${STAGING_RECOVERY_RUNTIME_ACCEPTED:-false}" == true ]] ||
      fail 'separate owner runtime acceptance required'
    [[ -z "${STAGING_DEPLOY_SUCCEEDED_REVISION:-}" ]] ||
      fail 'recovery must not claim failed workflow was successful'
    # Evidence is an independently owner-verified, narrow input file. This
    # file is an attestation, not a cloud API proof or logical restore test.
    evidence="${STAGING_RECOVERY_EVIDENCE_FILE:-/nonexistent}"
    [[ -f "$evidence" && ! -L "$evidence" && "$evidence" == /* ]] ||
      fail 'owner-verified snapshot/recovery evidence file required'
    [[ "$(stat -c %s "$evidence")" -le 4096 ]] || fail 'recovery evidence too large'
    grep -Fxq -- 'snapshot=s-j6ccgk5wyg44gmzqgf5v status=Success' "$evidence" ||
      fail 'snapshot success evidence missing'
    grep -Fxq -- 'workflow_run=41982285823 conclusion=failure reason=post_disk_gate' "$evidence" ||
      fail 'failed deployment acknowledgement missing'
    grep -Fxq -- "owner_approval=${STAGING_RETENTION_APPROVAL_ID}" "$evidence" ||
      fail 'owner approval not bound to recovery evidence'
    # Only the two owner-conditionally-listed release pairs are eligible.
    # No additional historical, dangling, infra or unknown image is in scope.
    if [[ "$batch2" == true ]]; then
      recovery_a="$batch2_recovery_a"
      recovery_b="$batch2_recovery_b"
      declare -A recovery_api_ids=(
        ["$recovery_a"]=sha256:25dec94a82dfa4cee25cd5110fd857cc3785423cf0cba46c55711bda9e89bcac
        ["$recovery_b"]=sha256:3f6fa4334bc9dba8650a1ad68e3ee6c6f823429a6cadff8bef6f315987f75c76
      )
      declare -A recovery_worker_ids=(
        ["$recovery_a"]=sha256:6dfd97eec6928f3f26608dd0091a6f97d4be9b653057af0b619d6400cfffffb3
        ["$recovery_b"]=sha256:c3092df879a8cc7a06980188527d17b425616f66e9d0aed4ad2551b9850c6c75
      )
      grep -Fxq -- "batch=2 candidate_a=$recovery_a candidate_b=$recovery_b" "$evidence" ||
        fail 'batch 2 exact revisions not attested by owner'
    elif [[ "$phase_d" == true ]]; then
      recovery_a="$phase_d_recovery_a"
      recovery_b="$phase_d_recovery_b"
      declare -A recovery_api_ids=(
        ["$recovery_a"]=sha256:4d2ff2b68cfa70b817188e336f0e7ee5141b8779e46f52d9d3c925b2fec9060c
        ["$recovery_b"]=sha256:5050682df3ebf4f557ce13196b155e6f6da28c539711a994e014828f39685452
      )
      declare -A recovery_worker_ids=(
        ["$recovery_a"]=sha256:7d5d3c5fd943d7c2d539a2f55468b530da480c1988739bd373d09b23389955e2
        ["$recovery_b"]=sha256:cd2d14433275772b3d4dc34efe6935e21558139fe3ab2fae30333188038cacc3
      )
      grep -Fxq -- 'fresh_snapshot=s-j6cazgfr54fw87udingl status=accomplished progress=100% source_disk=d-j6c6f95ns1nggo7h11io' "$evidence" ||
        fail 'Phase D fresh snapshot evidence missing'
      grep -Fxq -- "batch=3 candidate_a=$recovery_a candidate_b=$recovery_b" "$evidence" ||
        fail 'Phase D exact revisions not attested by owner'
    else
      recovery_a="$known_recovery_a"
      recovery_b="$known_recovery_b"
      declare -A recovery_api_ids=(
        ["$recovery_a"]=sha256:426eca170257042c73941d6920e0828304daa34020f86e3858f375b42b17ea2d
        ["$recovery_b"]=sha256:7fcd05927e19fe566301516fdce1d3ab2297c8ef88b27454c16299d2e321fb96
      )
      declare -A recovery_worker_ids=(
        ["$recovery_a"]=sha256:80f9bebe35e74e43da0cf49ca03f5abef8229ec179e600c0bbc1767ca9c00001
        ["$recovery_b"]=sha256:9d2b3678ad02365397724f7ea1a57fac77e6654e45e57c3c0031314fb728fe7f
      )
    fi
    expected_plan=$(printf '%s\n' \
      "$recovery_a ${recovery_api_ids[$recovery_a]} ${recovery_worker_ids[$recovery_a]}" \
      "$recovery_b ${recovery_api_ids[$recovery_b]} ${recovery_worker_ids[$recovery_b]}")
    [[ "$(LC_ALL=C sort -- "$STAGING_RETENTION_APPROVED_PLAN")" == "$(printf '%s\n' "$expected_plan" | LC_ALL=C sort)" ]] ||
      fail 'recovery plan must contain exactly two owner-approved revision/image-ID triples'
    printf 'AUDIT one_time_recovery=true batch2=%s phase_d=%s historic_workflow_conclusion=failure run_id=41982285823\n' "$batch2" "$phase_d"
  else
    [[ "${STAGING_DEPLOY_SUCCEEDED_REVISION:-}" == "$current" ]] ||
      fail 'verified successful deployment revision is required'
  fi
fi

# Shared with staging deployment. Never delete during a deployment.
# Dry-run must NOT create/write even a lock file: reuse an existing lock
# via a read-only descriptor or run as advisory if no lock file exists.
lock="${STAGING_DEPLOY_LOCK:-/tmp/xiaohai-staging-deploy.lock}"
command -v flock >/dev/null || fail 'flock unavailable'
if [[ "$deleting" == true ]]; then
  exec 9>"$lock" || fail 'cannot acquire deployment lock'
  flock -n 9 || fail 'deployment/retention operation already running'
elif [[ -e "$lock" ]]; then
  exec 9<"$lock" || fail 'cannot read existing deployment lock'
  flock -n 9 || fail 'deployment/retention operation already running'
else
  echo 'AUDIT dry-run: no existing deploy lock; observation only, no mutation'
fi
[[ "$(docker context show)" == default ]] || fail 'unexpected Docker context'

api_repo='ghcr.io/fredilly/xiaohai-api'
worker_repo='ghcr.io/fredilly/xiaohai-worker'
declare -A protected_ids=()
declare -A seen_revision_images=()
for rev in "${protected_revisions[@]}"; do
  for repo in "$api_repo" "$worker_repo"; do
    id=$(docker image inspect --format '{{.Id}}' "$repo:$rev") || fail "protected image missing: $repo:$rev"
    [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid protected image ID'
    # Multiple release labels pointing at one image do not represent
    # two independently restorable rollback releases.
    role="${repo##*-}"
    [[ -z "${seen_revision_images["$role:$id"]:-}" ]] ||
      fail "current/rollback ${role} releases share image ID: $id"
    seen_revision_images["$role:$id"]=1
    protected_ids["$id"]=1
  done
done

for image in postgres:17-alpine redis:7.4-alpine caddy:2-alpine; do
  id=$(docker image inspect --format '{{.Id}}' "$image") || fail "protected infrastructure image missing: $image"
  protected_ids["$id"]=1
done
# Preserve every unknown/untagged image; the referenced image ID must remain protected.
protected_ids['sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb']=1

if [[ "$deleting" == true || "$planning" == true ]]; then
  for volume in xiaohai-staging_postgres_data xiaohai-staging_redis_data xiaohai-staging_caddy_data xiaohai-staging_caddy_config; do
    docker volume inspect "$volume" >/dev/null || fail "protected volume unavailable: $volume"
  done
  for service in api worker; do
    ref="ghcr.io/fredilly/xiaohai-$service:$current"
    [[ "$(docker inspect --format '{{.Config.Image}}' "xiaohai-staging-$service-1")" == "$ref" ]] ||
      fail "running $service revision changed"
    [[ "$(docker inspect --format '{{.State.Running}}' "xiaohai-staging-$service-1")" == true ]] ||
      fail "$service container is not running"
    expected_id=$(docker image inspect --format '{{.Id}}' "$ref") ||
      fail "current $service image unavailable"
    [[ "$(docker inspect --format '{{.Image}}' "xiaohai-staging-$service-1")" == "$expected_id" ]] ||
      fail "running $service image ID differs from exact current revision"
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

# Only explicitly known deployment files may be searched. Never traverse /opt,
# /home or containerd: root-recursive scans risk substantial I/O on a small host.
# An operator must verify other live service references independently before
# setting coverage; no successful audit is implied by this code-only PR.
init_config_scan() {
  [[ "${STAGING_CONFIG_COVERAGE_CONFIRMED:-false}" == true ]] ||
    fail 'deployment configuration coverage not verified; explicit operator attestation required'

  local base="${STAGING_DEPLOY_CONFIG_DIR:-/home/admin/xiaohai-deploy}" file size canonical
  [[ "$base" == /* && "$base" != *'/../'* && "$base" != *'/./'* && "$base" != *'//'*
    && "$base" != / && "$base" != /home && "$base" != /opt
    && "$base" != /opt/containerd && "$base" != /opt/containerd/*
    && "$base" != /var/lib/containerd && "$base" != /var/lib/containerd/*
    && "$base" != /var/lib/docker && "$base" != /var/lib/docker/* ]] ||
    fail 'invalid bounded deployment directory'
  [[ -d "$base" && ! -L "$base" ]] || fail 'deployment directory missing or symlinked'
  config_files=()
  retention_source_file="$base/staging-image-retention.sh"
  # Derived from staging-remote-deploy.sh and deploy/staging.compose.yml.
  # All must exist: absence means deployment references are not fully known.
  for file in revision.env staging.env staging.compose.yml Caddyfile \
    staging-remote-deploy.sh staging-disk-gate.sh staging-image-retention.sh; do
    config_files+=("$base/$file")
  done

  local -a additional_files=()
  read -r -a additional_files <<< "${STAGING_EXTRA_DEPLOY_CONFIG_FILES:-}"
  (( ${#additional_files[@]} <= 16 )) || fail 'too many additional configuration paths'
  for file in "${additional_files[@]}"; do config_files+=("$file"); done

  for file in "${config_files[@]}"; do
    [[ "$file" == /* && "$file" != *'/../'* && "$file" != *'/./'* && "$file" != *'//'*
      && "$file" != *'*'* && "$file" != *'?'* && "$file" != *'['*
      && "$file" != /opt/containerd/* && "$file" != /var/lib/containerd/*
      && "$file" != /var/lib/docker/* ]] || fail 'unsafe configuration path'
    [[ -f "$file" && ! -L "$file" ]] || fail 'deployment config file missing or symlinked'
    canonical=$(realpath -e -- "$file") || fail 'cannot resolve configuration file'
    [[ "$canonical" == "$file" ]] || fail 'configuration path resolves outside allowlist'
    size=$(stat -c '%s' -- "$file") || fail 'cannot size configuration file'
    [[ "$size" =~ ^[0-9]+$ ]] || fail 'invalid configuration file size'
    (( size <= 1048576 )) || fail 'configuration file exceeds bounded 1MiB scan limit'
    sudo -n test -r "$file" || fail 'configuration file unreadable with readonly privilege'
  done
  (( ${#config_files[@]} <= 23 )) || fail 'configuration allowlist exceeds bounded limit'
  printf 'AUDIT config_scan=bounded files=%s max_file_bytes=1048576 timeout_seconds=5\n' "${#config_files[@]}"
}

init_config_scan

check_config() {
  local rev="$1" status file matches line
  # The source script itself embeds two pinned incident SHAs in its audited
  # allowlist. Those two exact assignment lines are NOT live deployment refs.
  # Any other occurrence in that source (or ANY occurrence in other known
  # deployment config paths) remains an unconditional exclusion. Never skip
  # a whole config file or silently ignore a failed/timeout scan.
  for file in "${config_files[@]}"; do
    if [[ "$file" == "$retention_source_file" ]]; then
      status=0
      matches=$(timeout --signal=TERM --kill-after=1s 5s sudo -n grep -F -- "$rev" "$file") || status=$?
      if [[ "$status" -eq 0 ]]; then
        while IFS= read -r line; do
          [[ "$line" == "known_recovery_a=$rev" || "$line" == "known_recovery_b=$rev" ||
             "$line" == "batch2_recovery_a=$rev" || "$line" == "batch2_recovery_b=$rev" ]] ||
            return 1
        done <<< "$matches"
      elif [[ "$status" -ne 1 ]]; then
        fail "bounded configuration scan failed (exit=$status)"
      fi
    else
      if timeout --signal=TERM --kill-after=1s 5s sudo -n grep -Fq -- "$rev" "$file"; then
        return 1 # Another config still references this old version: protect.
      else
        status=$?
        [[ "$status" -eq 1 ]] || fail "bounded configuration scan failed (exit=$status)"
      fi
    fi
  done
}

capacity() {
  local data inode_data
  data=$(df -Pk /) || fail 'cannot read available disk'
  inode_data=$(df -Pi /) || fail 'cannot read inode capacity'
  read -r FREE_KIB USED_PCT < <(printf '%s\n' "$data" | awk 'NR==2 {gsub(/%/, "", $5); print $4,$5}')
  INODE_PCT=$(printf '%s\n' "$inode_data" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
  [[ "$FREE_KIB" =~ ^[0-9]+$ && "$USED_PCT" =~ ^[0-9]+$ && "$INODE_PCT" =~ ^[0-9]+$ ]] ||
    fail 'invalid disk/inode df output'
  (( USED_PCT <= 100 && INODE_PCT <= 100 )) || fail 'invalid disk/inode percentage'
  (( INODE_PCT < 85 )) || fail 'inode usage at or above emergency threshold'
}

healthy() {
  [[ "$(docker inspect --format '{{.State.Health.Status}}' xiaohai-staging-postgres-1)" == healthy ]] || fail 'PostgreSQL unhealthy'
  local redis status
  redis=$(docker exec xiaohai-staging-redis-1 redis-cli INFO persistence | tr -d '\r') || fail 'Redis persistence read failed'
  printf '%s\n' "$redis" | grep -qx 'rdb_last_bgsave_status:ok' || fail 'Redis RDB unhealthy'
  printf '%s\n' "$redis" | grep -qx 'aof_last_write_status:ok' || fail 'Redis AOF unhealthy'
  # Health and readiness must pass for EVERY deletion mode, not only
  # the incident recovery exception.
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://staging-api.pamboo.asia/health) ||
    fail 'API health probe unavailable'
  [[ "$status" == 200 ]] || fail 'API health non-200'
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://staging-api.pamboo.asia/ready) || fail 'API readiness probe unavailable'
  [[ "$status" == 200 ]] || fail 'API readiness non-200'
}

if [[ "$deleting" == true || "$planning" == true ]]; then
  healthy
  capacity
fi

# A recovery batch is all-or-nothing at preflight: validate BOTH exact pairs
# before the first removal. If the second pair drifted, do not delete the first.
if [[ "$recovery" == true ]]; then
  for rev in "$recovery_a" "$recovery_b"; do
    refresh_refs
    ref="$api_repo:$rev"
    check_candidate "$ref" || fail "recovery API candidate unavailable or referenced: $rev"
    [[ "$REPLY" == "${recovery_api_ids[$rev]}" ]] || fail 'recovery API image ID differs from owner allowlist'
    ref="$worker_repo:$rev"
    check_candidate "$ref" || fail "recovery Worker candidate unavailable or referenced: $rev"
    [[ "$REPLY" == "${recovery_worker_ids[$rev]}" ]] || fail 'recovery Worker image ID differs from owner allowlist'
    check_config "$rev" || fail "recovery deployment config still references old release: $rev"
  done
  echo 'AUDIT recovery_preflight=all_four_exact_images_passed'
fi

count=0
while IFS= read -r rev; do
  [[ -n "$rev" ]] || continue
  # No named protected/HOLD release may ever become a candidate, even if idle.
  if [[ -n "${protected_revision_set[$rev]:-}" ]]; then
    printf 'PROTECTED_REVISION revision=%s\n' "$rev"
    continue
  fi
  if [[ "$recovery" == true && "$rev" != "$recovery_a" && "$rev" != "$recovery_b" ]]; then
    continue
  fi
  api="$api_repo:$rev"
  worker="$worker_repo:$rev"
  # Never remove a half-release or images with references/aliases/unknown IDs.
  refresh_refs
  check_candidate "$api" || { printf 'SKIP revision=%s reason=api_unverifiable_or_referenced\n' "$rev"; continue; }
  api_id="$REPLY"
  check_candidate "$worker" || { printf 'SKIP revision=%s reason=worker_unverifiable_or_referenced\n' "$rev"; continue; }
  worker_id="$REPLY"
  check_config "$rev" || { printf 'SKIP revision=%s reason=deployment_config_reference\n' "$rev"; continue; }
  if [[ "$recovery" == true ]]; then
    [[ "$api_id" == "${recovery_api_ids[$rev]:-}" && "$worker_id" == "${recovery_worker_ids[$rev]:-}" ]] ||
      fail 'recovery candidate exact image ID mismatch'
  fi
  printf 'AUDIT mode=%s revision=%s api=%s api_id=%s worker=%s worker_id=%s\n' \
    "$mode" "$rev" "$api" "$api_id" "$worker" "$worker_id"
  if [[ "$planning" == true ]]; then
    [[ "$api_id" != "$worker_id" ]] || fail 'same API and Worker image ID invalid'
    printf 'PLAN revision=%s api_id=%s worker_id=%s\n' "$rev" "$api_id" "$worker_id"
    count=$((count + 1))
    if (( count >= 2 )); then
      echo 'PLAN maximum_two_pairs=true'
      break
    fi
    continue
  fi
  [[ "$deleting" == true ]] || continue

  capacity
  if [[ "$mode" != --steady-state-execute ]] && (( FREE_KIB >= 15728640 || USED_PCT <= 70 )); then
    echo 'STOP target reached; no more deletions'
    break
  fi
  before="$FREE_KIB"
  before_inodes="$INODE_PCT"
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
  # The Docker image removals are COMPLETE, regardless of when containerd
  # asynchronously collects orphaned snapshots/content blobs. Never attribute
  # pending GC to deletion failure, or continue removing further pairs while
  # the actual disk benefit is unknown. No prune or direct snapshot deletion.
  count=$((count + 1))
  printf 'AUDIT deletion_completed=true revision=%s api_id=%s worker_id=%s deleted_pairs=%s\n' \
    "$rev" "$api_id" "$worker_id" "$count"
  healthy
  # Give the normal containerd GC time without forcing it. Max 50 seconds,
  # checking disk/inode and service health again on each poll.
  reclaimed=false
  for gc_observation in 1 2 3 4 5 6; do
    capacity
    healthy
    if (( FREE_KIB > before )); then reclaimed=true; break; fi
    if (( gc_observation < 6 )); then sleep 10; fi
  done
  if [[ "$reclaimed" != true ]]; then
    printf 'RECLAIM_PENDING deletion_completed=true revision=%s deleted_pairs=%s before_kib=%s after_kib=%s\n' \
      "$rev" "$count" "$before" "$FREE_KIB"
    echo 'STOP no more image removals; later read-only df/health reconciliation required'
    exit 3
  fi
  printf 'AUDIT reclaimed_revision=%s deletion_completed=true before_kib=%s after_kib=%s reclaimed_kib=%s disk_used_pct=%s inode_before_pct=%s inode_after_pct=%s\n' \
    "$rev" "$before" "$FREE_KIB" "$((FREE_KIB - before))" "$USED_PCT" "$before_inodes" "$INODE_PCT"
  if (( count >= 2 )); then
    echo 'STOP batch maximum 2 revision pairs reached'
    break
  fi
done < <(printf '%s\n' "${!revisions[@]}" | sort)

if [[ "$planning" == true ]]; then
  echo "PLAN COMPLETE mode=$mode proposed_pairs=$count deleted_pairs=0 approval_status=NOT_GRANTED"
else
  echo "RETENTION COMPLETE mode=$mode deleted_pairs=$count"
fi
