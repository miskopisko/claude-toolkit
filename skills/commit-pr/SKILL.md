---
name: commit-pr
description: Commit the staged change and open a pull request against the trunk, in the repo's own commit and PR style, then move the tickets to In review (when a board is configured) and tick their met acceptance criteria. Use when the user has staged and gated their work and wants it committed and a PR raised.
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/workflow.py), Bash(python3 ${CLAUDE_SKILL_DIR}/precheck.py*), Bash(python3 ${CLAUDE_SKILL_DIR}/board.py *), Bash(python3 ${CLAUDE_SKILL_DIR}/tick.py *)
---

# Commit + PR

**This skill writes to git and the tracker.** The other workflow skills report and stop,
except `/prep-branch`, which takes the ticket it starts. Invoking this one is approval to
commit, push, open a PR, move its tickets to In review and tick their met criteria, but
**not** approval for a particular message, so there are two checkpoints below where you
show the text and wait.

`trunk`, `legacyBranches`, `board` and `rulesFile` come from the workflow config. See them
with `python3 ${CLAUDE_SKILL_DIR}/workflow.py`. If `rulesFile` is set, read it first. Its
rules win over this skill's defaults wherever they differ, including the house style below.

Hard rules:

- **Commit the index only.** Never `git commit -a`, never `git add` anything new. What is
  staged is the user's declared intent; adding to it silently is the worst failure mode here.
- **The PR targets the trunk**, never `main`/`master` when they aren't the trunk, and never
  a branch matching `legacyBranches`.
- Stop at the first checkpoint the user doesn't approve.

## 1. Precheck

```bash
python3 ${CLAUDE_SKILL_DIR}/precheck.py
```

Reports the branch, the PR base (always the trunk), the tickets (from the branch name and
any PR's closing issues), the top of the parent chain for the PR body, the staged set,
**everything not staged**, files hidden by `skip-worktree`, how far the branch is behind
the trunk, any legacy branch not yet on the trunk that the branch carries, whether a PR is
already open, and the house-style sources for step 2. Exits non-zero on a blocker.

Act on what it says:

| Signal | Do |
| --- | --- |
| nothing staged | stop — the user stages |
| on the trunk, `main`, `master` or a legacy branch | stop — cut a ticket branch (`/prep-branch`) |
| behind the trunk | merge `origin/<trunk>` in first, then re-run |
| carries a legacy branch not yet on the trunk | stop — the PR would bring its commits; ask the user |
| **a PR is already open** | this is a follow-up commit: commit, push, and stop. Do not open a second PR. If it answers review findings, use `/pr-comments` |
| unstaged/untracked listed | read them out and confirm each is deliberately excluded |

That last one matters: concurrent sessions share one working tree. Another session's
edits belong to its own ticket, not this commit.

**Confirm the gate ran.** If the user hasn't run `/gate`, say so and offer it. A commit
message carrying a `Verified:` trailer that nothing verified is worse than no trailer.

## 2. Draft the commit message — then stop

Learn the house style, first source that has one:

1. the rules file, if set;
2. the recent subjects and trailers precheck printed from `origin/<trunk>` (read a few full
   messages with `git log --no-merges -5 origin/<trunk>` if the bodies matter): prefix or
   none (`feat:`), case, ticket numbers in the subject or not, body length, trailers in use;
3. the default below.

Default:

```
<Imperative subject, sentence case, no prefix, no ticket number, no full stop>

<Why it was wrong or missing, then what changed. Prose, not bullets. Wrapped
at ~72 columns. Name the symptom before the fix — the reader is usually
someone hitting the symptom.>

Verified: <what /gate actually ran and passed; omit if the gate didn't run>
```

For example:

> `Keep the active filters when exporting a report as CSV`
> `Return 403 when a viewer requests another team's export`

In the default, ticket numbers appear in the body prose where they help, not in the
subject. End the message with the attribution lines Claude Code provides in this session,
if any (such as a `Co-Authored-By:` trailer); don't invent one.

**Show the full message and wait.** Then:

```bash
git commit -F <message-file>      # never -a, never -m with a one-liner body
git push                          # git push -u origin HEAD if precheck said first push
```

## 3. Draft the PR — then stop

Learn the PR style the same way: the rules file; else the PR template precheck found
(fill in its sections, don't replace them); else recent merged PRs
(`gh pr list --state merged --base <trunk> --limit 5 --json title,body`); else the default
below.

Default title: `<commit subject> (#<ticket>)`, listing both numbers if the branch covers two.

Default body:

```markdown
## <Title>

Part of #<ticket> (epic #<top of the parent chain>, if there is one). <What this makes work,
in a sentence or two, and what deliberately stays open: a ticket left open for follow-up
work is fine; say why.>

### What changed
- **<Area>:** <what and why. One bullet per area — backend, UI, docs, fixtures.>

### Deploy note
<Only when deploying needs a step: a migration or rebuild, a config value, an ordering
constraint against another PR. Omit the heading otherwise.>

### Merge note
<Only when a sibling PR touches the same files. Say which files conflict and how whoever
merges second should resolve them.>

### Testing
- <automated: what the new tests cover>
- <manual: what the user checked by hand, since nothing in CI covers it>
```

Whatever the style, end the body with the attribution line Claude Code provides in this
session, if any.

**Show it and wait.** Then:

```bash
gh pr create --base <trunk> --title "<title>" --body-file <body-file>
```

## 4. Move the cards to In review

By default, once the PR is open, without asking. Skip it only if the rules file or the user
says not to.

```bash
python3 ${CLAUDE_SKILL_DIR}/board.py <ticket>... --to inReview    # every ticket in the PR title
```

It moves each ticket's card to the board's `inReview` column, adding the card to the board
if it's missing, and leaves a card already there alone. It changes nothing else on the
ticket. **With no `board` in the config it moves nothing and says so; say so in the report
too.** If it fails for lack of the `project` scope, give the fix (`gh auth refresh -s project`).
A follow-up commit to a PR that's already open skips this step: its cards moved when the
PR opened.

## 5. Tick the met acceptance criteria

Also by default, straight after the board move (with or without a board). GitHub never ticks
an issue's checkboxes itself, and the desk plugin counts them, so a done ticket would
otherwise read 0 of n.

```bash
python3 ${CLAUDE_SKILL_DIR}/tick.py <ticket> --list      # positions, as the issue has them
python3 ${CLAUDE_SKILL_DIR}/tick.py <ticket> 1 3 4       # tick those
```

Tick only what `/gate`'s ACCEPTANCE section reported as ✅ met, by position. Leave ⚠️ partial
and ❌ not met unticked, and say which in the report. If the gate didn't run in this session,
there is no verdict to act on: list the criteria and ask rather than tick from memory. Only
the box characters change; a box already ticked stays ticked.

## 6. Report

Give the PR URL, the board move (or that there is no board), the criteria ticked (and any
left open), and say what happens next: CI runs the repo's checks, including any jobs
`/gate` could not run locally (precheck lists them from `gate.notLocal`), and any automated
reviewer the repo uses will review. `/pr-comments` works that round.

Do not merge. Merging into the trunk is the user's call, and ordering against sibling PRs
usually matters.
