#!/usr/bin/env python3
"""Move tickets' cards to a status column on the project's GitHub Projects board.

Shared by prep-branch (In progress, when a ticket is taken) and commit-pr (In review, once
its PR is open). Identical copies ship in both skills, so each folder works on its own;
scripts/check-shared.sh keeps them in step.

Writes to the tracker, and only to the card's Status field: assignees, labels and the issue
itself are untouched. Idempotent: a card already in the column is left alone, and a ticket
missing from the board is added to it. The board and its columns are looked up by name on
each run, so a renamed column fails loudly instead of landing the card in the wrong place.
A board's own workflows can move a card straight back (GitHub's "Pull request linked to
issue" fires a few seconds after a PR opens), so after a move it waits, reads the card
again, and puts it back if it was moved, saying so.
The board may belong to an organization or a user: the repository's owner is searched
first, then the projects linked to the repository, then your own.

Does nothing when the workflow config has no `board`.

Usage:  python3 board.py <ticket>... [--to inProgress|inReview|"<column>"] [--repo owner/name] [--dry-run]
        --to defaults to inReview. inProgress and inReview name the columns set in the
        config's `board`; anything else is taken as a column name. --dry-run looks
        everything up and says what it would do, without writing.
"""
import json
import subprocess
import sys
import time

from workflow import load

STATUS_FIELD = "Status"
# A board workflow answers a move or a PR link within a few seconds; wait this long before re-reading.
SETTLE_S = 10
# How many times to put a card back before giving up on it.
RETRIES = 2

_FRAGMENT = """
fragment B on ProjectV2 {
  id title closed
  field(name:"%s") { ... on ProjectV2SingleSelectField { id options { id name } } }
}""" % STATUS_FIELD

BOARDS = """
query($owner:String!, $name:String!) {
  repositoryOwner(login:$owner) {
    ... on Organization { projectsV2(first:100) { nodes { ...B } } }
    ... on User { projectsV2(first:100) { nodes { ...B } } }
  }
  repository(owner:$owner, name:$name) { projectsV2(first:100) { nodes { ...B } } }
  viewer { projectsV2(first:100) { nodes { ...B } } }
}""" + _FRAGMENT

ITEMS = """
query($owner:String!, $name:String!, $n:Int!) {
  repository(owner:$owner, name:$name) { issue(number:$n) {
    id title
    projectItems(first:50) { nodes {
      id
      project { id }
      fieldValueByName(name:"%s") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
    } }
  } }
}""" % STATUS_FIELD

ADD = """
mutation($project:ID!, $content:ID!) {
  addProjectV2ItemById(input:{projectId:$project, contentId:$content}) { item { id } }
}"""

SET = """
mutation($project:ID!, $item:ID!, $field:ID!, $option:String!) {
  updateProjectV2ItemFieldValue(input:{projectId:$project, itemId:$item, fieldId:$field,
    value:{singleSelectOptionId:$option}}) { projectV2Item { id } }
}"""


class BoardError(Exception):
    pass


def _graphql(query, **fields):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in fields.items():
        args += ["-F" if isinstance(v, int) else "-f", f"{k}={v}"]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        err = r.stderr.strip()
        if "INSUFFICIENT_SCOPES" in err or "required scopes" in err.lower():
            err += "\n(GitHub Projects need the `project` scope: gh auth refresh -s project)"
        raise BoardError(f"gh api graphql failed:\n{err}")
    return json.loads(r.stdout)["data"]


def _split(repo):
    owner, _, name = repo.partition("/")
    if not owner or not name:
        raise BoardError(f"repo must be owner/name, not '{repo}'")
    return owner, name


def find_board(repo, title):
    """The open project called `title`, with its Status field and options."""
    owner, name = _split(repo)
    data = _graphql(BOARDS, owner=owner, name=name)
    pools = [((data.get("repositoryOwner") or {}).get("projectsV2") or {}).get("nodes") or [],
             ((data.get("repository") or {}).get("projectsV2") or {}).get("nodes") or [],
             ((data.get("viewer") or {}).get("projectsV2") or {}).get("nodes") or []]
    matches = [p for pool in pools for p in pool if p and p["title"] == title]
    board = next((p for p in matches if not p.get("closed")), None) or (matches[0] if matches else None)
    if not board:
        raise BoardError(f"no project called '{title}' owned by {owner}, linked to {repo}, or yours")
    if not board.get("field"):
        raise BoardError(f"project '{title}' has no single-select '{STATUS_FIELD}' field")
    return board


def column_name(cfg, to):
    """inProgress / inReview -> the configured column name; anything else is a column name."""
    if to in ("inProgress", "inReview"):
        return (cfg.get("board") or {}).get(to) or to
    return to


def current(repo, n, board):
    """(issue, item-or-None, current column name-or-None) for ticket n on board."""
    owner, name = _split(repo)
    t = (_graphql(ITEMS, owner=owner, name=name, n=n).get("repository") or {}).get("issue")
    if not t:
        raise BoardError(f"no issue #{n} in {repo}")
    item = next((i for i in t["projectItems"]["nodes"] if i["project"]["id"] == board["id"]), None)
    status = ((item or {}).get("fieldValueByName") or {}).get("name")
    return t, item, status


def _option(board, column):
    option = next((o for o in board["field"]["options"] if o["name"] == column), None)
    if not option:
        names = ", ".join(o["name"] for o in board["field"]["options"])
        raise BoardError(f"'{board['title']}' has no '{column}' column (has: {names})")
    return option


def _set(board, item, option):
    _graphql(SET, project=board["id"], item=item["id"], field=board["field"]["id"], option=option["id"])


def move(repo, n, column, board, dry_run=False):
    """Put ticket n's card in `column` on `board`, adding the card if it's missing.

    Returns (a line to print, whether it wrote anything)."""
    option = _option(board, column)
    t, item, status = current(repo, n, board)
    label = f"#{n} {board['title']}"
    if status == column:
        return f"{label}: {column} (already)", False
    was = status or ("(no status)" if item else "(not on the board)")
    if dry_run:
        return f"{label}: {was} → {column} (dry run: nothing changed)", False
    if not item:
        item = _graphql(ADD, project=board["id"], content=t["id"])["addProjectV2ItemById"]["item"]
    _set(board, item, option)
    return f"{label}: {was} → {column}", True


def settle(repo, tickets, column, board):
    """After moving `tickets`, wait for the board's workflows, then put back any card they moved.

    Returns a line to print for each card that was moved back; raises if one won't stay."""
    lines, pending = [], list(tickets)
    for _ in range(RETRIES + 1):
        if not pending:
            break
        time.sleep(SETTLE_S)
        moved_back = []
        for n in pending:
            _, item, status = current(repo, n, board)
            if status != column:
                moved_back.append((n, item, status))
        if not moved_back:
            return lines
        pending = []
        for n, item, status in moved_back:
            _set(board, item, _option(board, column))
            lines.append(f"#{n} {board['title']}: the board moved it to {status or '(no status)'}; "
                         f"put back in {column}")
            pending.append(n)
    if pending:
        raise BoardError(f"{', '.join(f'#{n}' for n in pending)} keeps being moved off {column} "
                         f"by a workflow on '{board['title']}' (the project's ⋯ → Workflows)")
    return lines


def _take(args, flag, default):
    if flag not in args:
        return default
    i = args.index(flag)
    if i + 1 >= len(args):
        sys.exit(f"{flag} needs a value")
    value = args[i + 1]
    del args[i:i + 2]
    return value


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]
    cfg = load()
    to = _take(args, "--to", "inReview")
    repo = _take(args, "--repo", cfg["repo"])
    if not args or not all(a.lstrip("#").isdigit() for a in args):
        sys.exit('usage: board.py <ticket>... [--to inProgress|inReview|"<column>"] [--repo owner/name] [--dry-run]')
    tickets = [int(a.lstrip("#")) for a in args]
    if not cfg.get("board") or not cfg["board"].get("name"):
        print("No board configured (`board` in the workflow config): skipping the board move.")
        return
    if not repo:
        sys.exit("⛔ no repo: set `repo` in the workflow config or pass --repo")
    column = column_name(cfg, to)
    try:
        board = find_board(repo, cfg["board"]["name"])
        moved = []
        for n in tickets:
            line, wrote = move(repo, n, column, board, dry_run)
            print(line, flush=True)
            if wrote:
                moved.append(n)
        for line in settle(repo, moved, column, board):
            print(line)
    except BoardError as e:
        sys.exit(f"⛔ {e}")


if __name__ == "__main__":
    main()
