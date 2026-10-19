#!/usr/bin/env bash
# Usage: day-activity.sh YYYY-MM-DD ROOT [ROOT...]
# Prints, per git repo under the ROOTs, the commits you authored on that date,
# plus GitHub PRs you are involved in that were open on that day.
# "You" is your global git email and name plus any set in each repo.
# Runs on Linux and macOS (GNU or BSD date; timeout or gtimeout if installed).
set -u
if [[ $# -lt 2 ]]; then
  echo "usage: $0 YYYY-MM-DD ROOT [ROOT...]" >&2
  exit 2
fi
day="$1"; shift

# The date N days from day, with N signed (-1, +2).
offset() { date -d "$day $1 day" +%F 2>/dev/null || date -j -v"$1"d -f %F "$day" +%F; }
since=$(offset -1)
until=$(offset +2)

# A fetch that would ask for a password or passphrase fails instead of hanging.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -o BatchMode=yes"
limit=()
if command -v timeout >/dev/null; then limit=(timeout 20)
elif command -v gtimeout >/dev/null; then limit=(gtimeout 20)
fi

roots=()
for r in "$@"; do roots+=("${r/#\~/$HOME}"); done

find "${roots[@]}" -maxdepth 4 -type d -name .git -not -path '*/node_modules/*' 2>/dev/null |
while read -r g; do
  repo=${g%/.git}
  authors=()
  for who in "$(git config --global user.email)" "$(git config --global user.name)" \
             "$(git -C "$repo" config user.email)" "$(git -C "$repo" config user.name)"; do
    [[ -n "$who" ]] && authors+=(--author="$who")
  done
  [[ ${#authors[@]} -eq 0 ]] && continue
  ${limit[@]+"${limit[@]}"} git -C "$repo" fetch --all --quiet >/dev/null 2>&1
  commits=$(git -C "$repo" log --all --fixed-strings "${authors[@]}" \
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
