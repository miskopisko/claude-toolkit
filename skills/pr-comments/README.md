# pr-comments

Part of [claude-toolkit](../../README.md). See there for everything else in it and how to add the marketplace.

Works a pull request's unresolved review threads to the end: assess each finding, fix the ones you agree with, then reply to and resolve every thread once the fix is pushed. It works the same for a human reviewer or a bot. Each finding is judged on its merits against the current code; nothing gets fixed just because a reviewer said so.

```
/pr-comments          # the PR for the branch you're on
/pr-comments 412      # a specific PR
```

You can also just ask Claude to "go through the review comments on this PR".

## Install

```
/plugin marketplace add miskopisko/claude-toolkit
/plugin install pr-comments@miskopisko
```

Install [`gh`](https://cli.github.com/) and run `gh auth login`.

## Settings

pr-comments is one of five workflow skills (next, prep-branch, gate, commit-pr and pr-comments) that share one config file: `.claude/workflow.json` at the repository root, committed for the team, with `.claude/workflow.local.json` beside it for your own overrides (git-ignore that one). Every key is optional. With no file at all, the repo comes from `gh`.

The keys pr-comments uses:

```json
{
  "repo": "acme/shop-web",
  "rulesFile": "docs/working-agreements.md"
}
```

- `repo`: the repository the PR is in, used for the reply API.
- `rulesFile`: a doc of your team's standing rules. pr-comments reads it first, and its rules win, for example on how replies are worded or who resolves threads.

## How it works

1. **Fetches the threads** with [`threads.py`](threads.py): every unresolved thread on the PR, with the ids needed to reply and resolve, the reviewer, and the whole conversation. Threads on lines that have since changed are marked outdated.
2. **Assesses each finding**: what it says is wrong, whether it holds against the current code, agree or disagree with the evidence, the fix, and how serious it is. Then it stops, and you choose what to fix.
3. **Applies the agreed fixes** and runs `/gate` on what it touched. It doesn't stage, commit or push unless you ask; `/commit-pr` does that.
4. **Replies and resolves**, only after the fix is on the remote. Each reply names the commit, what changed and why that answers the finding, in your project's style if it has one. Findings you disagreed with get the reasoning, not silence.
5. **Offers a writeup** of the round: each finding and its verdict, wrong ones included, for you to place or skip.
6. **Loops** while new threads come in.

## Requirements

Python 3, `git` and `gh`, on Linux or macOS.
