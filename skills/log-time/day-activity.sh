#!/usr/bin/env bash
# Usage: day-activity.sh YYYY-MM-DD ROOT [ROOT...]
# Prints, per git repo under the ROOTs, the commits you authored on that date,
# plus GitHub PRs you are involved in that were open on that day.
set -u
day="$1"; shift
email=$(git config --global user.email)
name=$(git config --global user.name)
since=$(date -d "$day -1 day" +%F)
until=$(date -d "$day +2 day" +%F)

roots=()
for r in "$@"; do roots+=("${r/#\~/$HOME}"); done

find "${roots[@]}" -maxdepth 4 -type d -name .git -not -path '*/node_modules/*' 2>/dev/null |
while read -r g; do
  repo=${g%/.git}
  timeout 20 git -C "$repo" fetch --all --quiet >/dev/null 2>&1
  commits=$(git -C "$repo" log --all --author="$email" --author="$name" \
      --since="$since" --until="$until" --date=format:'%F %H:%M' \
      --pretty='%ad | %s' 2>/dev/null | awk -F' [|] ' -v d="$day" 'substr($1,1,10)==d' | sort -u)
  remote=$(git -C "$repo" remote get-url origin 2>/dev/null)
  prs=""
  if [[ "$remote" == *github.com* ]] && command -v gh >/dev/null; then
    prs=$(cd "$repo" && gh pr list --state all --limit 50 \
      --search "involves:@me updated:>=$day created:<=$day" \
      --json number,title,headRefName,state,author,createdAt,mergedAt,closingIssuesReferences \
      --jq ".[] | select((.mergedAt // \"9999\")[:10] >= \"$day\") | \"PR #\(.number) [\(.state)] by \(.author.login) \(.headRefName) | \(.title) | closes: \([.closingIssuesReferences[].number]|join(\",\")) | created \(.createdAt[:10]) merged \((.mergedAt // \"-\")[:10])\"" 2>/dev/null)
  fi
  if [[ -n "$commits" || -n "$prs" ]]; then
    echo "=== ${repo/#$HOME/\~}  ($remote)"
    [[ -n "$commits" ]] && echo "$commits" | sed 's/^/  /'
    [[ -n "$prs" ]] && echo "$prs" | sed 's/^/  /'
    echo
  fi
done
