#!/usr/bin/env bash
# Staging deploy transaction: gate before registry auth; always clean isolated credentials.
# No database migrations, seeds, image cleanup or production deployment.
set -euo pipefail

fail() { printf 'STAGING_DEPLOY_ERROR: %s\n' "$*" >&2; exit 1; }

[[ "${REVISION:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'expected exact 40-character CI revision'
[[ "$(docker context show)" == default ]] || fail 'unexpected Docker context'
[[ -f staging.env && -f staging.compose.yml && -f staging-disk-gate.sh ]] ||
  fail 'staging deployment configuration missing'

# Web continuity is default OFF and cannot be disabled silently after activation.
web_enabled="${STAGING_WEB_ENABLED:-false}"
[[ "$web_enabled" == true || "$web_enabled" == false ]] ||
  fail 'invalid STAGING_WEB_ENABLED; expected true or false'
[[ ! -L staging-web.active ]] || fail 'web activation sentinel cannot be symlinked'
if [[ "$web_enabled" == false && -e staging-web.active &&
      "${STAGING_WEB_DEACTIVATION_APPROVED:-false}" != true ]]; then
  fail 'previously activated web overlay cannot silently revert to base-only'
fi

lock="${STAGING_DEPLOY_LOCK:-/tmp/xiaohai-staging-deploy.lock}"
exec 9>"$lock"
flock -n 9 || fail 'deployment or retention operation already holds lock'

# No registry token may be persisted until all read-only capacity gates pass.
bash staging-disk-gate.sh pre

# When ON, require two immutable, human-approved main-SHA web releases and
# effective base+overlay config. Do this before registry auth/revision switch.
compose_files=(-f staging.compose.yml)
if [[ "$web_enabled" == true ]]; then
  [[ -f staging-web-verify.sh ]] || fail 'web verification script missing'
  bash staging-web-verify.sh || fail 'web release or Compose overlay preflight failed'
  compose_files+=(-f staging-web.compose.yml)
fi

# Never reuse ~/.docker/config.json or overwrite a deployer's existing credentials.
# Docker Compose inherits this isolated config for the registry pull.
docker_config=$(mktemp -d "${TMPDIR:-/tmp}/xiaohai-docker-auth.XXXXXXXX") ||
  fail 'cannot create temporary Docker authentication directory'
export DOCKER_CONFIG="$docker_config"

cleanup() {
  local status=$?
  trap - EXIT
  # Do not print registry credentials or the Docker config file.
  docker logout ghcr.io >/dev/null 2>&1 || true
  rm -f -- "$docker_config/config.json" || true
  rmdir -- "$docker_config" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# The token arrives via SSH stdin only after the gate passed. No token is logged.
docker login ghcr.io -u xiaohai-deploy --password-stdin >/dev/null

printf 'REVISION=%s\n' "$REVISION" > revision.env
docker compose --env-file staging.env --env-file revision.env "${compose_files[@]}" pull
docker compose --env-file staging.env --env-file revision.env "${compose_files[@]}" up -d --remove-orphans

# Only change this sentinel after Compose reports success. An accidental flag
# reset cannot drop live web mounts on a later API deployment.
if [[ "$web_enabled" == true ]]; then
  printf 'WEB_ACTIVE_SHA=%s\n' "$STAGING_WEB_RELEASE_SHA" > staging-web.active
elif [[ "${STAGING_WEB_DEACTIVATION_APPROVED:-false}" == true && -e staging-web.active ]]; then
  rm -f -- staging-web.active
fi
echo 'STAGING_DEPLOY_OK: registry session will be cleaned on exit'
