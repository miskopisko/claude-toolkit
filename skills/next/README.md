# next

Part of [claude-toolkit](../../README.md). See there for everything else in it and how to add the marketplace.

Tells you what to pick up next on an epic in a GitHub repo. It walks the epic's sub-issues, sorts every open ticket into in flight, takeable, blocked and so on, adds what the tracker can't see (uncommitted work, staged files, open PRs), and ends with one recommendation. It only reads: it never assigns, labels, branches or comments.

```
/next          # the epic of the branch you're on
/next 412      # a specific epic
```

You can also just ask Claude "where was I?" or "what's next on this epic?".

## Install

```
/plugin marketplace add miskopisko/claude-toolkit
/plugin install next@miskopisko
```

Install [`gh`](https://cli.github.com/) and run `gh auth login`.

## Settings

next is one of five workflow skills (next, prep-branch, gate, commit-pr and pr-comments) that share one config file: `.claude/workflow.json` at the repository root, committed for the team, with `.claude/workflow.local.json` beside it for your own overrides (git-ignore that one). Every key is optional. With no file at all, the repo and trunk come from `gh` and git, and the rest takes the defaults shown in [`workflow.py`](workflow.py).

The keys next uses:

```json
{
  "repo": "acme/shop-web",
  "trunk": "main",
  "branchPrefix": "feature/",
  "legacyBranches": ["release/*"],
  "labels": {
    "ready": ["ready-for-agent", "ready-for-human"],
    "parked": ["revisit-later", "wontfix"],
    "spec": "spec",
    "needsTriage": "needs-triage"
  },
  "rulesFile": "docs/working-agreements.md"
}
```

- `repo`, `trunk`: where the tickets live, and the branch tickets branch from and PR into.
- `branchPrefix`: how it finds the ticket from your branch (`feature/412-csv-export`).
- `legacyBranches`: globs for long-lived branches still being finished. Tickets merged into one of them are closed but not on the trunk yet, so next warns before recommending work that depends on them. Leave it empty to skip the check.
- `labels`: which labels mean ready to take, parked, a spec (whose own sub-issues count as part of the epic), and needs triage.
- `rulesFile`: a doc of your team's standing rules. next reads it first, and its rules win.

Run `python3 workflow.py` from inside the repo to see the merged settings.

## How it works

1. **Finds the epic** from the argument, or from the ticket in your branch name and its parent issue. It asks rather than guess.
2. **Walks the tree** with [`frontier.py`](frontier.py): the epic's sub-issues, plus the sub-issues of any child labelled as a spec. Each open ticket lands in one bucket: in flight (yours), takeable now, unblocked but not marked ready, blocked, parked, or assigned to others. Blockers come from GitHub's issue dependencies, not the "Blocked by" text in a body. It also flags tickets you wrote that still carry the needs-triage label.
3. **Adds local state**: commits ahead of the trunk, uncommitted and staged changes, skip-worktree files, and open PRs. Finished work that was never committed gets called out loudly.
4. **Recommends one thing**: finish uncommitted work, then answer review threads (`/pr-comments`), then continue what's in flight, then the lowest-numbered takeable ticket.

It stops there. `/prep-branch <n>` sets up the branch when you say go.

## Requirements

Python 3, `git` and `gh`, on Linux or macOS. The epic's tickets must be GitHub sub-issues of it, and blockers GitHub issue dependencies.
