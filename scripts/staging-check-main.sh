#!/usr/bin/env bash
# Read-only, fail-closed latest main check for queued staging Actions.
set -euo pipefail
expected="${STAGING_CI_SHA:-}"
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo "ERROR invalid CI SHA" >&2; exit 1; }
[[ -n "${GITHUB_OUTPUT:-}" ]] || { echo "ERROR GitHub output path missing" >&2; exit 1; }
remote=$(git ls-remote --exit-code origin refs/heads/main) || { echo "ERROR cannot inspect origin/main" >&2; exit 1; }
[[ "$remote" =~ ^([0-9a-f]{40})[[:space:]]+refs/heads/main$ ]] || { echo "ERROR malformed origin/main" >&2; exit 1; }
latest="${BASH_REMATCH[1]}"
if [[ "$latest" == "$expected" ]]; then
  echo "current=true" >> "$GITHUB_OUTPUT"
  echo "STAGING_CURRENT_MAIN verified=$expected"
else
  echo "current=false" >> "$GITHUB_OUTPUT"
  echo "STAGING_SKIP_SUPERSEDED old=$expected new=$latest"
fi
