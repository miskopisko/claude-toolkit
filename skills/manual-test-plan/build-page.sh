#!/usr/bin/env bash
# Usage: build-page.sh PLAN.json OUT.html
# Puts a plan (see PLAN-FORMAT.md) into template.html and writes the page.
# Fails if the plan isn't valid JSON (checked with python3 or jq when one is
# installed); warns about {{…}} placeholders left unfilled.
set -u
if [[ $# -ne 2 ]]; then
  echo "usage: $0 PLAN.json OUT.html" >&2
  exit 2
fi
plan="$1"; out="$2"
template="$(cd "$(dirname "$0")" && pwd)/template.html"

if command -v python3 >/dev/null; then
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$plan" || { echo "$plan is not valid JSON" >&2; exit 1; }
elif command -v jq >/dev/null; then
  jq empty "$plan" || { echo "$plan is not valid JSON" >&2; exit 1; }
fi

mkdir -p "$(dirname "$out")"
# In valid JSON, "<" can only appear inside strings, so replacing every "<"
# with the escape < leaves the data unchanged and keeps a "</script>" in
# the plan from closing the page's script tag.
awk -v plan="$plan" '
  $0 == "__PLAN_JSON__" {
    while ((getline line < plan) > 0) { gsub(/</, "\\u003c", line); print line }
    next
  }
  { print }
' "$template" > "$out" || exit 1

left=$(grep -o '{{[^}]*}}' "$plan" | sort -u)
if [[ -n "$left" ]]; then
  echo "warning: unfilled placeholders in $plan:" >&2
  echo "$left" | sed 's/^/  /' >&2
fi
echo "$out"
