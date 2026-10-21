#!/usr/bin/env bash
# Files that several skills ship identical copies of, so each skill folder works on its own.
# Fails if any copy differs from the first. Run from the repository root.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0
for name in workflow.py board.py; do
  copies=(skills/*/"$name")
  [[ -e "${copies[0]}" ]] || continue
  for c in "${copies[@]:1}"; do
    if ! cmp -s "${copies[0]}" "$c"; then
      echo "$c differs from ${copies[0]}" >&2
      status=1
    fi
  done
  echo "$name: ${#copies[@]} copies checked"
done
exit $status
