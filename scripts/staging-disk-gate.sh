#!/usr/bin/env bash
# Staging-only, read-only disk/inode gate. Never frees space itself.
set -euo pipefail

stage="${1:-pre}"
[[ "$stage" == pre || "$stage" == post ]] || { echo 'ERROR staging disk gate: expected pre or post' >&2; exit 2; }
min_free_kib="${STAGING_MIN_FREE_KIB:-4194304}"
[[ "$min_free_kib" =~ ^[0-9]+$ ]] || { echo 'ERROR staging disk gate: invalid free-space minimum' >&2; exit 2; }

capacity=$(df -Pk /) || { echo 'ERROR staging disk gate: cannot read filesystem capacity' >&2; exit 1; }
inodes=$(df -Pi /) || { echo 'ERROR staging disk gate: cannot read inode capacity' >&2; exit 1; }
read -r available_kib usage_pct < <(printf '%s\n' "$capacity" | awk 'NR==2 {gsub(/%/, "", $5); print $4, $5}')
read -r inode_pct < <(printf '%s\n' "$inodes" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
for number in "$available_kib" "$usage_pct" "$inode_pct"; do
  [[ "$number" =~ ^[0-9]+$ ]] || { echo 'ERROR staging disk gate: invalid df output' >&2; exit 1; }
done
(( usage_pct <= 100 && inode_pct <= 100 )) || { echo 'ERROR staging disk gate: invalid usage percent' >&2; exit 1; }

printf 'STAGING_DISK stage=%s disk_used_pct=%s inode_used_pct=%s available_kib=%s min_free_kib=%s\n' \
  "$stage" "$usage_pct" "$inode_pct" "$available_kib" "$min_free_kib"

if (( usage_pct >= 70 || inode_pct >= 70 )); then
  echo "WARNING staging usage: disk=${usage_pct}% inode=${inode_pct}% (threshold 70%)"
fi
if (( usage_pct >= 85 || inode_pct >= 85 )); then
  echo 'ERROR staging deploy blocked: disk/inode usage >=85%' >&2
  exit 1
fi
if [[ "$stage" == pre ]] && (( available_kib < min_free_kib )); then
  echo 'ERROR staging deploy blocked: insufficient estimated image-pull headroom' >&2
  exit 1
fi
printf 'STAGING_DISK_GATE PASS stage=%s\n' "$stage"
