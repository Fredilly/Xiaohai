#!/usr/bin/env bash
set -euo pipefail

event="${1:-}"
result="${2:-}"
case "$event" in
  pull_request)
    if [ "$result" != "success" ]; then
      echo "::error::PR review-scope MUST succeed; skipped is not acceptable on pull requests."
      exit 1
    fi
    ;;
  push)
    if [ "$result" != "skipped" ] && [ "$result" != "success" ]; then
      echo "::error::Review-scope was neither skipped nor successful on main push."
      exit 1
    fi
    ;;
  *)
    echo "::error::Unknown GitHub event for review-scope gate."
    exit 1
    ;;
esac
