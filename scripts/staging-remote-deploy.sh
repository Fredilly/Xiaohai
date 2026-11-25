#!/usr/bin/env bash
# Staging deploy transaction: gate before registry auth; always clean isolated credentials.
# No database migrations, seeds, image cleanup or production deployment.
set -euo pipefail

fail() { printf 'STAGING_DEPLOY_ERROR: %s\n' "$*" >&2; exit 1; }

[[ "${REVISION:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'expected exact 40-character CI revision'
[[ "$(docker context show)" == default ]] || fail 'unexpected Docker context'
[[ -f staging.env && -f staging.compose.yml && -f staging-disk-gate.sh ]] ||
  fail 'staging deployment configuration missing'

lock="${STAGING_DEPLOY_LOCK:-/tmp/xiaohai-staging-deploy.lock}"
exec 9>"$lock"
flock -n 9 || fail 'deployment or retention operation already holds lock'

# No registry token may be persisted until all read-only capacity gates pass.
bash staging-disk-gate.sh pre

# The opt-in file preserves shared ingress across future staging releases.
# Never detach a running cohost production stack from its public route.
# These checks run before registry authentication or revision writes.
if [[ -f cohost.enabled ]]; then
  [[ ! -L cohost.enabled && -f staging-cohost.override.yml && -f Caddyfile.cohost && -f Caddyfile.preserved && ! -L Caddyfile.preserved ]] ||
    fail 'cohost marker exists but approved ingress files are missing'
  [[ "$(docker network inspect --format '{{.Internal}}' xiaohai-production-edge 2>/dev/null)" == true ]] ||
    fail 'cohost shared network missing or not internal'
  docker compose --env-file staging.env -f staging.compose.yml -f staging-cohost.override.yml config --quiet ||
    fail 'cohost merged ingress config invalid'
  # Syntax-check the complete Caddy imports in a disposable, offline container.
  # No live proxy reload or production network connection occurs here.
  docker run --rm --network none --entrypoint caddy \
    -v "$PWD/Caddyfile.cohost:/etc/caddy/Caddyfile:ro" \
    -v "$PWD/Caddyfile:/etc/caddy/Caddyfile.staging-base:ro" \
    -v "$PWD/Caddyfile.preserved:/etc/caddy/Caddyfile.preserved:ro" \
    caddy:2-alpine validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null ||
    fail 'cohost Caddy configuration syntax invalid'
else
  cohost_containers=$(docker ps --format '{{.Names}}' --filter label=com.docker.compose.project=xiaohai-production-cohost) ||
    fail 'cannot enumerate production cohost containers'
  [[ -z "$cohost_containers" ]] ||
    fail 'production cohost containers exist but ingress marker is missing; stop to protect routing'
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
if [[ -f cohost.enabled ]]; then
  docker compose --env-file staging.env --env-file revision.env -f staging.compose.yml -f staging-cohost.override.yml pull
  docker compose --env-file staging.env --env-file revision.env -f staging.compose.yml -f staging-cohost.override.yml up -d --remove-orphans
else
  docker compose --env-file staging.env --env-file revision.env -f staging.compose.yml pull
  docker compose --env-file staging.env --env-file revision.env -f staging.compose.yml up -d --remove-orphans
fi
echo 'STAGING_DEPLOY_OK: registry session will be cleaned on exit'
