---
name: prep-branch
description: Prepare the local checkout to start a ticket. Puts the user on a ticket branch cut from the latest trunk that tracks it, with nothing in the working tree in the way, and takes the ticket (assigns it to the user and, if a board is configured, moves its card to In progress). Use when the user is about to start a ticket, says go after /next, or asks to set up, refresh or prep their branch.
argument-hint: "[ticket]   e.g. /prep-branch, /prep-branch 412"
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/workflow.py), Bash(python3 ${CLAUDE_SKILL_DIR}/preflight.py *), Bash(python3 ${CLAUDE_SKILL_DIR}/take.py *)
---

# Prep branch

End state: the user is on `<branchPrefix><n>-<slug>`, which contains the tip of
`origin/<trunk>` and tracks it, the working tree is exactly as clean as it was, and the
ticket is assigned to the user and, when a board is configured, sits in its In progress
column.

```
<branchPrefix><n>-<slug>  → tracks → origin/<trunk>
```

`trunk`, `branchPrefix`, `legacyBranches` and `board` come from the workflow config. See
them with `python3 ${CLAUDE_SKILL_DIR}/workflow.py`. Tickets branch from the trunk and their
PRs target it. A parent ticket or epic is context for the report, not a branch to build on.
Branches matching `legacyBranches` are long-lived ones still being finished: never branch
from them or rebase their commits into a ticket.

If the config sets `rulesFile`, read that file first. Its rules win over this skill's
defaults wherever they differ.

**Two hard guardrails:**

- **Every push needs its own yes**, including the force-push a rebased, already-pushed
  branch requires.
- **Every command that can lose local work needs its own yes**: `git clean`,
  `reset --hard`, `checkout -- <file>`, `restore`, `stash drop`, `branch -D`, `rm`, and
  restores that delete what is installed, such as `npm ci` (it wipes `node_modules`) or
  `uv sync`. Show exactly what would go, then wait.

## 1. Preflight

Resolve the ticket from the user's message, else from a `<branchPrefix><n>-…` branch name,
else ask. Then:

```bash
git fetch origin --prune
python3 ${CLAUDE_SKILL_DIR}/preflight.py <n>
git rev-parse HEAD        # note as START, for step 4
```

The script reports the ticket's readiness and parent chain, whether the local trunk has
drifted from `origin/<trunk>`, any existing `<branchPrefix><n>-*` branch, and the working
tree. Every `⛔` line is a decision for the user; it exits non-zero while any remain.

For a dirty tree, list the files and offer, without choosing:

- leave them and stop, so the user can deal with them;
- `git stash push -u -m "prep-branch <n>: <what>"` (keeps everything, recoverable);
- carry them onto the new branch, only if they don't touch files the switch changes.

Uncommitted files may belong to **another session**: concurrent sessions share this one
working tree, so a branch switch pulls the floor out from under them. Ask before assuming
the files are leftovers.

A `⛔` on a skip-worktree file means the switch would abort with "Your local changes … would
be overwritten" while `git status` shows a clean tree. `git ls-files -v | grep '^S'` lists
these files. Recover like this, each step on the user's yes, unless the rules file gives
another way:

```bash
git update-index --no-skip-worktree <file>
git stash push -m "prep-branch <n>: local edit to <file>" -- <file>
# … do the switch or rebase in step 2 …
git stash pop            # may conflict: the upstream change and the local edit disagree;
                         # resolve by hand, keeping both. A conflicted pop keeps the stash.
git update-index --skip-worktree <file>
```

Done when preflight prints `PREFLIGHT: clear`, or the user has explicitly overridden each
remaining `⛔` (an untriaged, not-ready or unassigned ticket is a warning, not a blocker).

## 2. The ticket branch

If a local trunk branch exists and is only behind origin, fast-forward it so it doesn't go
stale: `git fetch origin <trunk>:<trunk>` (refused while it is checked out; use
`git merge --ff-only origin/<trunk>` there instead).

**None exists.** Name it `<branchPrefix><n>-<slug>`, where the slug is the title's core in
2–4 kebab words. For example, #412 "Let admins export a filtered report as CSV" becomes
`feature/412-csv-export`.

```bash
git switch -c <branchPrefix><n>-<slug> origin/<trunk>
git branch --set-upstream-to=origin/<trunk>
```

**One exists, with 0 commits ahead of the trunk:** `git switch` to it and
`git merge --ff-only origin/<trunk>`.

**One exists, with commits of its own:** `git rebase origin/<trunk>`. Commits that already
reached the trunk (a legacy branch merged with a merge commit) drop out by themselves. If
preflight flagged that the branch contains a legacy branch **not yet on the trunk**, stop:
a rebase would carry that branch's commits into the ticket's PR. Ask whether to wait for it
or move only the ticket's own commits with `git rebase --onto origin/<trunk> <last commit of the legacy branch>`.

If that branch is already pushed, rebasing it means another force-push. Ask first, and
offer `git merge origin/<trunk>` as the alternative.

Upstream: set it to `origin/<trunk>`, including on a branch that still tracks a legacy
branch. Leave it alone if the branch is already pushed and tracks its own
`origin/<branchPrefix><n>-…`.

Done when `git rev-parse --abbrev-ref @{u}` names `origin/<trunk>` (or the branch's own
remote), and `git merge-base --is-ancestor origin/<trunk> HEAD` succeeds.

## 3. Take the ticket

By default, once the branch is in place, without asking. Skip it only if the rules file or
the user says not to.

```bash
python3 ${CLAUDE_SKILL_DIR}/take.py <n>
```

It assigns the ticket to the user and, when the config has a `board`, moves its card to
the board's `inProgress` column, adding the card to the board if it's missing. With no
`board` it only assigns, and says so. Anything already right is left alone. It refuses a
ticket assigned to someone else. Preflight raises that as a `⛔`, so it only fires if the
user overrode the `⛔` without saying to take the ticket over.

If the board move fails because `gh` lacks the `project` scope, say so and give the fix
(`gh auth refresh -s project`); don't retry in a loop.

Done when it prints the user as assignee and, with a board, the In progress column.
Implementation does not start before that.

## 4. Verify and report

```bash
git status -sb                                    # branch...upstream, tree as clean as at START
git merge-base --is-ancestor origin/<trunk> HEAD && echo "trunk contained"
git ls-files -v | grep '^S'                       # skip-worktree files are still hidden
python3 ${CLAUDE_SKILL_DIR}/preflight.py --deps START
```

The last line lists the lockfiles and manifests that changed since START, in any ecosystem
(npm, Yarn, pnpm, Bun, .NET, Python, Ruby, Go, Rust, PHP, Elixir, Dart, CocoaPods, Maven,
Gradle), with the restore command for each and the folder to run it in. Offer those
restores. Run any of them only on a yes, and one marked as deleting what is installed
(`npm ci`, `uv sync`) falls under the second guardrail: say what it removes before asking.

Report briefly: what each step found and changed, every command that rewrote or pushed
anything, what step 3 did, and anything the user declined. End with the first-push note.
Plain `git push` is refused because the branch name differs from its upstream
(`push.default=simple`). Use `git push -u origin HEAD` instead, which also moves the
upstream to the branch's own remote, ready for a PR into the trunk with `/commit-pr`.

Then stop. Implementation starts when the user says so. After it, `/gate` checks the work
and `/commit-pr` commits it and opens the PR.
