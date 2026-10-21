#!/usr/bin/env python3
"""Take a ticket before implementation starts: assign it to the user and, when the workflow
config has a `board`, move its card to the board's In progress column.

Writes to the tracker (preflight.py is the read-only half). Idempotent: an assignee or
column that is already right is left alone. Refuses a ticket assigned to someone else.
The board move is board.py's, the same module commit-pr uses for In review.

Usage:  python3 take.py <ticket-number> [--repo owner/name] [--dry-run]
"""
import json
import subprocess
import sys

import board
from workflow import load


def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"failed: {' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout.strip()


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]
    cfg = load()
    repo = cfg["repo"]
    if "--repo" in args:
        i = args.index("--repo")
        if i + 1 >= len(args):
            sys.exit("usage: take.py <ticket-number> [--repo owner/name] [--dry-run]")
        repo = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1 or not args[0].lstrip("#").isdigit():
        sys.exit("usage: take.py <ticket-number> [--repo owner/name] [--dry-run]")
    if not repo:
        sys.exit("⛔ no repo: set `repo` in the workflow config or pass --repo")
    n = int(args[0].lstrip("#"))
    me = run("gh", "api", "user", "--jq", ".login")

    t = json.loads(run("gh", "issue", "view", str(n), "--repo", repo, "--json", "title,assignees"))
    print(f"## TAKE #{n} — {t['title']}")

    # ── Assignee ────────────────────────────────────────────────────────────
    who = [a["login"] for a in t["assignees"]]
    if me in who:
        print(f"  assignee: {me} (already)")
    elif who:
        sys.exit(f"  ⛔ assigned to someone else ({','.join(who)}) — not taking it over")
    elif dry_run:
        print(f"  assignee: would assign {me} (dry run: nothing changed)")
    else:
        run("gh", "issue", "edit", str(n), "--repo", repo, "--add-assignee", "@me")
        print(f"  assignee: {me} (assigned)")

    # ── Board column ────────────────────────────────────────────────────────
    if not cfg.get("board") or not cfg["board"].get("name"):
        print("  board: none configured (`board` in the workflow config), so only assigned")
        return
    try:
        b = board.find_board(repo, cfg["board"]["name"])
        column = board.column_name(cfg, "inProgress")
        line, wrote = board.move(repo, n, column, b, dry_run)
        print("  " + line, flush=True)
        for line in board.settle(repo, [n] if wrote else [], column, b):
            print("  " + line)
    except board.BoardError as e:
        sys.exit(f"  ⛔ {e}")


if __name__ == "__main__":
    main()
