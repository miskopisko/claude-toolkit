---
name: next
description: Orient on an epic in a GitHub repo — what's in flight, what's takeable, what's blocked, and the one thing to do next. Read-only. Use when the user asks where they left off, what's next on an epic, what state a ticket tree is in, or starts a session after time away.
argument-hint: "[epic]   e.g. /next, /next 412"
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/frontier.py *), Bash(python3 ${CLAUDE_SKILL_DIR}/workflow.py)
---

# Next

Answer one question: **what should I pick up right now?**

**Read-only. This skill never writes to the tracker, to git or to files.** No assigning, no
labelling, no branching, no commenting, no staging. It reports and recommends; the user acts.

## 0. Read the settings

```bash
python3 ${CLAUDE_SKILL_DIR}/workflow.py
```

It prints the merged workflow config (`.claude/workflow.json`, then `.claude/workflow.local.json`,
then what git and `gh` work out). This skill uses `repo`, `trunk`, `branchPrefix`,
`legacyBranches`, `labels` and `rulesFile`. Below, `<trunk>` and `<branchPrefix>` mean the
values printed there.

If `rulesFile` is set, read that file now. Its rules win over this skill's defaults wherever
they disagree.

## 1. Resolve the epic

In order:

1. An epic number in the argument or the user's message.
2. The current branch: `<branchPrefix><n>-…`, or a branch matching one of `legacyBranches`
   that carries a number. Resolve `<n>` to its issue and walk up to the epic with
   `gh issue view <n> --json parent` (or the "Parent" line in the body). If `<n>` has no
   parent, it may itself be the epic; check it has sub-issues. On `<trunk>` itself there is
   no ticket to go on; fall through to asking.
3. Ask. Don't guess between two candidates.

## 2. Walk the tree

```bash
python3 ${CLAUDE_SKILL_DIR}/frontier.py <epic-number>
```

It resolves the epic's sub-issues **and** the sub-issues of any child carrying the
`labels.spec` label, then classifies every open ticket by assignee and **open** blocker count
(GitHub's native `issue_dependencies_summary.blocked_by`, which is the live gate, not the
"Blocked by" prose in a body, which goes stale). Pass `--repo owner/name` to look at another
repo and `--me <login>` to see it as someone else.

Buckets, in the order it prints them:

| Bucket | Means |
| --- | --- |
| **IN FLIGHT (yours)** | assigned to you, open: finish these before starting anything |
| **TAKEABLE NOW** | unassigned, unblocked, carries one of `labels.ready` |
| **UNBLOCKED, NOT MARKED READY** | nothing gates it, but no ready label: usually written and never triaged |
| **BLOCKED** | has open blockers; show the count, don't recommend these |
| **PARKED** | carries one of `labels.parked`: mention only if asked |
| **ASSIGNED TO OTHERS** | someone else's |

It also flags open tickets **the user authored** that still carry `labels.needsTriage`.
Triage is for issues you did not create, so that label on your own ticket is a mistake, not
a state.

Last, if `legacyBranches` is set, it lists every remote branch matching those globs that
holds commits not on `origin/<trunk>` (step 3 says why). With `legacyBranches` empty the
check is skipped.

## 3. Add local state: the tracker doesn't know this

Tickets branch from `<trunk>` and their PRs target it, so `<trunk>` is the reference point.

```bash
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "(not pushed)"
git log --oneline origin/<trunk>..HEAD                 # commits ahead of the trunk
git status --short                                     # uncommitted + staged
git ls-files -v | grep '^S'                            # skip-worktree files
gh pr list --state open --json number,title,headRefName,baseRefName,author,reviewDecision
```

**The trap this catches:** work that is finished but never committed. A branch with an
upstream, zero commits ahead of `<trunk>`, and a dirty tree means the work exists only on
this machine. Say so loudly: it reads as "done" on the board and is one `git clean` from
gone. If the project's rules say the user commits only when they ask, this state is normal
mid-flight and abnormal at day's end.

Another Claude session may be working in the same tree. Changes you don't recognise may be
theirs: report them, don't attribute them.

**Skip-worktree files** (`S` in `git ls-files -v`) are local edits git is told to ignore.
They don't show in `git status`, so list them: they are easy to forget and easy to lose on a
checkout.

**Closed tickets whose code isn't on the trunk.** This only applies when step 2 listed
long-lived branches. Tickets worked on such a branch close when they merge into it, not into
`<trunk>`. A blocker that reads as closed can still be missing from `<trunk>`, which is what
you'd branch from. Before recommending a takeable ticket, check whether its closed blockers
merged into one of those branches (`gh issue view <blocker> --json closedByPullRequestsReferences`,
or the PR that closed it and its `baseRefName`). If they did, it's takeable on the board but
can't start yet; say so and name the branch.

Also report anything **staged**. Nothing should be staged without the user's approval, so
staged files they didn't approve are worth a line.

## 4. Report

Short. Buckets first, then local state, then **one** recommendation: the single next action,
not a menu. Pick it in this order:

1. Uncommitted work on the current branch → finish that first (`/gate`, review, `/commit-pr`).
2. An open PR of the user's with unresolved review threads → `/pr-comments`.
3. Something in IN FLIGHT → continue it.
4. The lowest-numbered item in TAKEABLE NOW.
5. Nothing takeable → say what would unblock the most tickets, and name the blocker.

If the only candidate sits in **UNBLOCKED, NOT MARKED READY**, say that it is takeable but
untriaged, and that it needs a ready label (or a spec) before it is formally grabbable. Don't
silently promote it.

## 5. Stop

Do not start the work. The user picks. If they say go, `/prep-branch <n>` sets up the branch
and takes the ticket (assigns it, and moves its card to In progress when `board` is set).
The desk plugin's side pane shows the branch, issue and PR state while they work.
