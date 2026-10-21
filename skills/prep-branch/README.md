# prep-branch

Part of [claude-toolkit](../../README.md). See there for everything else in it and how to add the marketplace.

Gets your checkout ready to start a ticket. It puts you on a ticket branch cut from the latest trunk that tracks it, leaves the working tree exactly as clean as it was, and takes the ticket: assigns it to you and, if your project has a GitHub Projects board, moves its card to In progress. It pushes only on your yes, and asks before any command that could lose local work.

```
/prep-branch          # the ticket in your message or branch name
/prep-branch 412      # a specific ticket
```

You can also just say "go" after `/next`, or ask Claude to "set up a branch for #412".

## Install

```
/plugin marketplace add miskopisko/claude-toolkit
/plugin install prep-branch@miskopisko
```

Install [`gh`](https://cli.github.com/) and run `gh auth login`. To move cards on a board, `gh` also needs the `project` scope: `gh auth refresh -s project`.

## Settings

prep-branch is one of five workflow skills (next, prep-branch, gate, commit-pr and pr-comments) that share one config file: `.claude/workflow.json` at the repository root, committed for the team, with `.claude/workflow.local.json` beside it for your own overrides (git-ignore that one). Every key is optional. With no file at all, the repo and trunk come from `gh` and git, and the rest takes the defaults shown in [`workflow.py`](workflow.py).

The keys prep-branch uses:

```json
{
  "repo": "acme/shop-web",
  "remote": "origin",
  "trunk": "main",
  "branchPrefix": "feature/",
  "legacyBranches": ["release/*"],
  "labels": {
    "ready": ["ready-for-agent", "ready-for-human"],
    "parked": ["revisit-later", "wontfix"],
    "spec": "spec",
    "needsTriage": "needs-triage"
  },
  "board": { "name": "Shop roadmap", "inProgress": "In progress", "inReview": "In review" },
  "rulesFile": "docs/working-agreements.md"
}
```

- `repo`, `trunk`: where the tickets live, and the branch tickets branch from and PR into.
- `remote`: the git remote for the shared repo, `origin` by default. In a fork, set it to the remote that points at the shared repo (often `upstream`); branches are cut from its trunk, and `repo` and `trunk` are worked out from it when unset.
- `branchPrefix`: ticket branches are named `<branchPrefix><n>-<slug>`, such as `feature/412-csv-export`.
- `legacyBranches`: globs for long-lived branches still being finished. prep-branch won't build on them, repoints a ticket branch that still tracks one, and stops before a rebase would carry one's unmerged commits into your ticket.
- `labels`: a ticket that is a spec, parked, or has sub-issues of its own is a blocker to confirm; one without a ready label, or still needing triage, is a warning. Each label setting takes one name or a list of names.
- `board`: the GitHub Project, owned by an organization or a user, whose `Status` column it sets to `inProgress`. Leave it out (or `null`) and taking a ticket only assigns it.
- `rulesFile`: a doc of your team's standing rules. prep-branch reads it first, and its rules win.

Run `python3 workflow.py` from inside the repo to see the merged settings.

## How it works

1. **Preflight** with [`preflight.py`](preflight.py), read-only: the ticket's state, labels, assignee, blockers and parent chain; whether your local trunk has drifted from the shared remote's; any branch for the ticket that already exists; and anything in the way in the working tree, including an operation in progress and skip-worktree files the switch would trip over. Every blocker is a question for you, and uncommitted files are never assumed to be leftovers, since another session may be using the same working tree.
2. **Sets up the branch**: creates it from `<remote>/<trunk>`, or brings an existing one up to date (fast-forward, or a rebase you approve if it's already pushed), and sets its upstream to the trunk.
3. **Takes the ticket** with [`take.py`](take.py), by default and without asking: assigns it to you and, with a `board`, moves its card to In progress, adding it to the board if it's missing. It refuses a ticket assigned to someone else. The board logic lives in [`board.py`](board.py), shared with commit-pr.
4. **Verifies and reports**, and lists the lockfiles and manifests that changed since it started, across npm, Yarn, pnpm, Bun, .NET, Python, Ruby, Go, Rust, PHP and more, with the matching restore to run on your yes. A restore that deletes what's installed, such as `npm ci`, is called out first.

It stops there. After the work, `/gate` checks it and `/commit-pr` commits it and opens the PR. If you use the optional [desk](../../plugins/desk) plugin, it shows the ticket and its PR beside the chat as you go.

Every push, and every command that could lose local work (`git clean`, `reset --hard`, `stash drop`, `branch -D`, `npm ci`, …), needs its own yes.

## Requirements

Python 3, `git` and `gh`, on Linux or macOS. The shared repo is the one the `remote` setting's git remote points at (`origin` unless you set it). Blockers come from GitHub issue dependencies and the parent chain from sub-issues.
