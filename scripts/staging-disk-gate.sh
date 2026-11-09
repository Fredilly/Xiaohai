#!/usr/bin/env bash
# Staging-only, read-only disk/inode gate. Never frees space itself.
set -euo pipefail

stage="${1:-pre}"
[[ "$stage" == pre || "$stage" == post ]] || { echo 'ERROR staging disk gate: expected pre or post' >&2; exit 2; }
min_free_kib="${STAGING_MIN_FREE_KIB:-4194304}"
# 2026-11-05 actual image-pair growth was ~1.25-1.33 GiB; allow 1.5 GiB.
expected_growth_kib="${STAGING_EXPECTED_IMAGE_PAIR_KIB:-1572864}"
for value in "$min_free_kib" "$expected_growth_kib"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo 'ERROR staging disk gate: invalid capacity estimate' >&2; exit 2; }
done
(( expected_growth_kib > 0 )) || { echo 'ERROR staging disk gate: growth estimate cannot be zero' >&2; exit 2; }

capacity=$(df -Pk /) || { echo 'ERROR staging disk gate: cannot read filesystem capacity' >&2; exit 1; }
inodes=$(df -Pi /) || { echo 'ERROR staging disk gate: cannot read inode capacity' >&2; exit 1; }
read -r total_kib available_kib usage_pct < <(printf '%s\n' "$capacity" | awk 'NR==2 {gsub(/%/, "", $5); print $2, $4, $5}')
read -r inode_pct < <(printf '%s\n' "$inodes" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
for number in "$total_kib" "$available_kib" "$usage_pct" "$inode_pct"; do
  [[ "$number" =~ ^[0-9]+$ ]] || { echo 'ERROR staging disk gate: invalid df output' >&2; exit 1; }
done
(( total_kib > 0 && available_kib <= total_kib && usage_pct <= 100 && inode_pct <= 100 )) || { echo 'ERROR staging disk gate: invalid filesystem metrics' >&2; exit 1; }

printf 'STAGING_DISK stage=%s disk_used_pct=%s inode_used_pct=%s available_kib=%s min_free_kib=%s\n' \
  "$stage" "$usage_pct" "$inode_pct" "$available_kib" "$min_free_kib"

if (( usage_pct >= 70 || inode_pct >= 70 )); then
  echo "WARNING staging usage: disk=${usage_pct}% inode=${inode_pct}% (threshold 70%)"
fi
if (( usage_pct >= 85 || inode_pct >= 85 )); then
  echo 'ERROR staging deploy blocked: disk/inode usage >=85%' >&2
  exit 1
fi
if [[ "$stage" == pre ]]; then
  projected_available_kib=$(( available_kib - expected_growth_kib ))
  printf 'STAGING_DISK_FORECAST growth_kib=%s projected_available_kib=%s post_limit_pct=85\n' \
    "$expected_growth_kib" "$projected_available_kib"
  if (( projected_available_kib < min_free_kib )); then
    echo 'ERROR staging deploy blocked: projected free space below safe headroom' >&2
    exit 1
  fi
  if (( (total_kib - projected_available_kib) * 100 >= total_kib * 85 )); then
    echo 'ERROR staging deploy blocked: projected disk usage >=85%' >&2
    exit 1
  fi
fi
printf 'STAGING_DISK_GATE PASS stage=%s\n' "$stage"
