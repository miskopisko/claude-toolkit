---
name: pr-comments
description: Work a GitHub pull request's unresolved review threads end to end — assess each finding on its merits, apply the fixes the user agrees to, then reply to and resolve every thread once the fix is pushed. Works for any reviewer, human or bot. Use when the user mentions PR review comments, review feedback, a bot's review, or a review round on a PR.
argument-hint: "[pr]   e.g. /pr-comments, /pr-comments 412"
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/threads.py *), Bash(python3 ${CLAUDE_SKILL_DIR}/workflow.py)
---

# PR comments

A review round on a PR, worked to completion: **assess → agree with the user → fix → push →
reply → resolve → record.**

Reviewers, human or bot, are **often right and sometimes wrong**. Assess each finding on its
merits, against the code as it is now. **Never fix something just because a reviewer said
it**, and never wave one away because it came from a bot.

## 0. Read the settings

```bash
python3 ${CLAUDE_SKILL_DIR}/workflow.py
```

This skill uses `repo` and `rulesFile` from the workflow config. If `rulesFile` is set, read
that file now. Its rules win over this skill's defaults wherever they disagree, including the
reply format and anything about staging or committing.

## 1. Fetch the threads

```bash
python3 ${CLAUDE_SKILL_DIR}/threads.py            # PR for the current branch
python3 ${CLAUDE_SKILL_DIR}/threads.py 412        # a specific PR
python3 ${CLAUDE_SKILL_DIR}/threads.py --all      # include resolved ones
```

Each thread prints its `thread_id` (for resolving), its first comment's `comment_id` (for
replying), the location, the reviewer (bots are marked), and every comment in the
conversation.

A thread flagged **OUTDATED** was written against a line that has since changed. It may
already be fixed, or it may have moved. Check the current code before assessing; don't
assume either way.

It also prints each reviewer's latest **review body**. Read it every round: reviewers, bots
especially, file findings there as well, often about code the last push didn't touch, so no
thread is ever raised for them. "0 unresolved" does not mean the round is done while a review
body holds findings. Number them after the threads and assess them the same way. They have
no thread to resolve, so in step 4 answer them with one PR comment (`gh pr comment <pr>
--body-file <file>`) that takes each in turn.

## 2. Assess each finding, then stop

For every unresolved thread, report:

- **Who raised it** and **what it says is wrong**, in one line.
- **Whether it holds**, checked against the *current* code, not the diff the reviewer saw.
- **Agree / disagree / partly**, with the reason. A disagreement needs evidence: the code
  path, the test that already covers it, the standard that permits it.
- **The fix you'd make**, concretely, if you agree.
- **Severity**: does it break something, or is it a preference?

Present them as a numbered list matching the script's numbering. Then **stop and wait.** The
user decides which to action. "Fix them if you agree" is an invitation to recommend, not
authority to proceed alone. A human reviewer's question may want an answer rather than a
change; say which.

## 3. Apply the agreed fixes

- **Do not stage, commit or push** unless the user asks. Make the edits, run `/gate` for
  whatever you touched, report, and stop. The user reviews the working tree and says when to
  commit; `/commit-pr` does that when they do.
- Another Claude session may share this working tree. Before editing, check `git status`;
  touch only the files the fixes need, and don't revert or reformat changes you didn't make.
- Update comments and docs in the same pass.
- If a fix touches CI configuration (`.github/` and the like), run whatever checks that
  config locally too: a comment-only change there can still turn CI red.

## 4. Reply and resolve, only after the fix is pushed

A reply that cites a commit the remote doesn't have yet is worse than no reply. Confirm the
push landed first (`git log origin/<branch> -1`, or `gh pr view --json commits`). Replying and
resolving write to GitHub, so ask before doing it unless the user already said to.

**Reply to a thread** (REST, uses `comment_id`; `<repo>` is `repo` from the config):

```bash
gh api repos/<repo>/pulls/<pr>/comments/<comment_id>/replies \
  -f body="Fixed in <sha>: <what changed>, so <why that answers the finding>."
```

**Resolve a thread** (GraphQL, uses `thread_id`):

```bash
gh api graphql -f query='
mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }' \
  -f t=<thread_id>
```

**Reply format.** Match the project's: take it from the rules file if it says, else from
replies already on this repo's PRs (`threads.py <recent pr> --all` shows them), else use this
default:

> **Fixed in `a1b2c3d`:** the CSV export now quotes fields that contain commas, so a customer
> name like "Smith, Jo" stays in one column instead of shifting the rest of the row.

Three parts: the sha, what changed, and why that answers the finding. For a finding you
**disagreed** with, reply with the reasoning and resolve anyway: an unresolved thread should
mean "open", not "unanswered". Never resolve silently. If the project leaves resolving to the
reviewer (some teams do, for human reviewers), reply and leave it open.

## 5. Record the round

After resolving, offer a short writeup of the round. Draft it; don't commit it:

```markdown
### Review round <n> (<reviewer>): <k> findings, <how many real>, <worst severity>

| # | Finding | Verdict |
| --- | --- | --- |
| 1 | <one line> | **Serious.** <what it would have broken> |
| 2 | <one line> | Real. |
| 3 | <one line> | Not a defect: <why> |
```

Record the wrong findings too. The hit rate is worth knowing, and a finding argued down and
recorded does not get re-raised next round.

Where it could go: a short note next to the code it concerns, like
`(Caught in review on #<pr>.)`, or the doc for that area if one exists, or nowhere. Offer it;
let the user place it or skip it.

## 6. Loop

A push may trigger a fresh review, from a bot or a person. If new threads appear, go back to
step 1 and increment the round number. Stop when `threads.py` reports nothing unresolved. The
desk plugin's side pane shows the unresolved thread count as it changes.
