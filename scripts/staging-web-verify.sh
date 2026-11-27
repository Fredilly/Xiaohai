#!/usr/bin/env bash
# Fail-closed validation for the operator-approved Store/HQ staging overlay.
# NO writes, deployments, or credentials. Run under staging's deployment lock.
set -euo pipefail

fail() { printf 'STAGING_WEB_STOP: %s\n' "$*" >&2; exit 1; }
[[ "${STAGING_WEB_ENABLED:-false}" == true ]] || fail 'web overlay was not explicitly enabled'
release="${STAGING_WEB_RELEASE_SHA:-}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || fail 'missing/invalid approved merged-main web release SHA'
[[ -f staging-web.Caddyfile && ! -L staging-web.Caddyfile ]] || fail 'candidate Caddy config missing or symlinked'
[[ -f staging-web.compose.yml && ! -L staging-web.compose.yml ]] || fail 'candidate Compose overlay missing or symlinked'
[[ -f staging.compose.yml && ! -L staging.compose.yml ]] || fail 'base Compose config unavailable'

for site in store admin; do
  root="web/$site"
  releases="$root/releases"
  target="releases/$release"
  [[ -d "$root" && ! -L "$root" && -d "$releases" && ! -L "$releases" ]] ||
    fail "$site release root missing or symlinked"
  [[ -L "$root/current" && "$(readlink -- "$root/current")" == "$target" ]] ||
    fail "$site current must be a relative symlink to the approved release"
  [[ -d "$releases/$release" && ! -L "$releases/$release" ]] || fail "$site immutable release missing"
  [[ -s "$releases/$release/index.html" && ! -L "$releases/$release/index.html" ]] ||
    fail "$site release index missing or symlinked"
  marker="$releases/$release/.xiaohai-release-revision"
  [[ -f "$marker" && ! -L "$marker" && "$(cat -- "$marker")" == "$release" ]] ||
    fail "$site artifact SHA marker mismatch"
  # Static resources are not permitted to include links escaping the immutable release.
  links=$(find "$releases/$release" -type l -print -quit) || fail "$site release cannot be inspected"
  [[ -z "$links" ]] || fail "$site release contains symlink"
  printf 'STAGING_WEB_VERIFIED site=%s revision=%s\n' "$site" "$release"
done

# --quiet never exposes resolved DB credentials to job output. The real Caddy
# candidate receives separate syntax checking in the PR-only build workflow.
docker compose --env-file staging.env -f staging.compose.yml -f staging-web.compose.yml config --quiet >/dev/null ||
  fail 'base + overlay Compose configuration invalid'
echo 'STAGING_WEB_VERIFIED overlay=base+web, no mutation'
