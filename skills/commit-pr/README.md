# commit-pr

Part of [claude-toolkit](../../README.md). See there for everything else in it and how to add the marketplace.

Commits what you've staged and opens a pull request against the trunk, in your repo's own commit and PR style. Then it moves the tickets' cards to In review, if your project has a GitHub Projects board, and ticks the acceptance criteria `/gate` found met. It commits the index only, never adds files, and shows you the commit message and the PR before using either.

```
/commit-pr
```

You can also just ask Claude to "commit this and open a PR".

## Install

```
/plugin marketplace add miskopisko/claude-toolkit
/plugin install commit-pr@miskopisko
```

Install [`gh`](https://cli.github.com/) and run `gh auth login`. To move cards on a board, `gh` also needs the `project` scope: `gh auth refresh -s project`.

## Settings

commit-pr is one of five workflow skills (next, prep-branch, gate, commit-pr and pr-comments) that share one config file: `.claude/workflow.json` at the repository root, committed for the team, with `.claude/workflow.local.json` beside it for your own overrides (git-ignore that one). Every key is optional. With no file at all, the repo and trunk come from `gh` and git, and the rest takes the defaults shown in [`workflow.py`](workflow.py).

The keys commit-pr uses:

```json
{
  "repo": "acme/shop-web",
  "remote": "origin",
  "trunk": "main",
  "branchPrefix": "feature/",
  "legacyBranches": ["release/*"],
  "board": { "name": "Shop roadmap", "inProgress": "In progress", "inReview": "In review" },
  "rulesFile": "docs/working-agreements.md",
  "gate": { "notLocal": ["e2e"] }
}
```

- `repo`, `trunk`: where the tickets live, and the branch the PR targets.
- `remote`: the git remote for the shared repo, `origin` by default. In a fork, set it to the remote that points at the shared repo (often `upstream`); the branch is compared against its trunk, while your branch is still pushed to your own push remote (`origin`, unless git's `remote.pushDefault` says otherwise).
- `branchPrefix`: how it reads the ticket numbers from your branch (`feature/412-csv-export`).
- `legacyBranches`: globs for long-lived branches still being finished. It won't commit on one or PR into one, and stops if your branch carries one's commits that aren't on the trunk yet. The trunk, `main` and `master` are protected too.
- `board`: the GitHub Project, owned by an organization or a user, whose `Status` column it sets to `inReview`. Leave it out (or `null`) and the board step is skipped, and the report says so.
- `rulesFile`: a doc of your team's standing rules and house style. commit-pr reads it first, and its rules win.
- `gate.notLocal`: CI jobs `/gate` can't run on your machine, named in the report as still to come.

Run `python3 workflow.py` from inside the repo to see the merged settings.

## How it works

1. **Prechecks** with [`precheck.py`](precheck.py): the branch and its tickets, the staged set, everything that is *not* staged (another session may share the working tree), skip-worktree files, how far behind the trunk the branch is, and whether a PR is already open (then it's a follow-up commit: commit, push, stop). It also prints where the house style comes from.
2. **Drafts the commit message** in the house style, learned from the rules file, else from recent commits on the trunk and their trailers, else a plain default: an imperative subject with no prefix or ticket number, a prose body that names the symptom before the fix, and a `Verified:` trailer only when `/gate` ran. You approve it before it commits and pushes.
3. **Drafts the PR**, styled from the rules file, else the repo's PR template, else recent merged PRs, else a default with What changed, Deploy note, Merge note and Testing sections. You approve it before it opens. Commits and PRs end with the attribution Claude Code provides in the session, if any.
4. **Moves the cards to In review** with [`board.py`](board.py), by default and without asking, when a `board` is set. If one of the board's own workflows moves a card back once the PR is linked (GitHub's "Pull request linked to issue" does this when it's set to another column), it puts the card back and tells you, so you can change that workflow.
5. **Ticks the met acceptance criteria** with [`tick.py`](tick.py), by default: only the ones `/gate` reported as met, by position, so the ticket's count of done criteria is right (the optional [desk](../../plugins/desk) plugin shows it). The criteria must be `- [ ]` checkboxes under a heading containing "Acceptance" in the issue body; a ticket without them is skipped, and the report says so.
6. **Reports** the PR, the moves and ticks, and what CI and review still have to do. `/pr-comments` works the review round. It never merges.

`/prep-branch` sets up the branch this starts from, and `/next` finds the ticket after.

## Requirements

Python 3, `git` and `gh`, on Linux or macOS. The shared repo is the one the `remote` setting's git remote points at (`origin` unless you set it).
