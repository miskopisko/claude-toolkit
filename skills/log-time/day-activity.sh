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
if [[ ! "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "$0: date must be YYYY-MM-DD, got '$day'" >&2
  exit 2
fi

# The date N days from day, with N signed (e.g. -1). GNU date, then BSD date.
offset() { date -d "$day $1 day" +%F 2>/dev/null || date -j -v"$1"d -f %Y-%m-%d "$day" +%F 2>/dev/null; }
since=$(offset -1)
if [[ -z "$since" ]]; then
  echo "$0: not a valid date: $day" >&2
  exit 2
fi

# A fetch that would ask for a password or passphrase fails instead of hanging.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -o BatchMode=yes"
# Your GitHub login, to pick out your own reviews and merges.
me=""
command -v gh >/dev/null && me=$(gh api user --jq .login 2>/dev/null)

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
  # --since filters on committer date, which is normally no earlier than the author
  # date, so it only trims old history. There is no --until: a commit rebased
  # days later keeps its author date, and awk below filters on that.
  commits=$(git -C "$repo" log --all --fixed-strings "${authors[@]}" \
      --since="$since" --date=format:'%F %H:%M' \
      --pretty='%ad | %s' 2>/dev/null | awk -F' [|] ' -v d="$day" 'substr($1,1,10)==d' | sort -u)
  remote=$(git -C "$repo" remote get-url origin 2>/dev/null)
  prs=""
  if [[ "$remote" == *github.com* ]] && command -v gh >/dev/null; then
    prs=$(cd "$repo" && gh pr list --state all --limit 50 \
      --search "involves:@me updated:>=$day created:<=$day" \
      --json number,title,headRefName,state,author,createdAt,mergedAt,closedAt,mergedBy,reviews,closingIssuesReferences \
      --jq ".[] | select((.closedAt // \"9999\")[:10] >= \"$day\")
        | ([.reviews[]? | select(.author.login == \"$me\" and .submittedAt[:10] == \"$day\")] | length) as \$rev
        | \"PR #\(.number) [\(.state)] by \(.author.login) \(.headRefName) | \(.title) | closes: \([.closingIssuesReferences[].number]|join(\",\")) | created \(.createdAt[:10]) merged \((.mergedAt // \"-\")[:10])\(if .mergedBy.login == \"$me\" and (.mergedAt // \"\")[:10] == \"$day\" then \" by you\" else \"\" end) | your reviews that day: \(\$rev)\"" 2>/dev/null)
  fi
  if [[ -n "$commits" || -n "$prs" ]]; then
    echo "=== ${repo/#$HOME/\~}  ($remote)"
    [[ -n "$commits" ]] && echo "$commits" | sed 's/^/  /'
    [[ -n "$prs" ]] && echo "$prs" | sed 's/^/  /'
    echo
  fi
done
