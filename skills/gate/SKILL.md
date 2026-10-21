---
name: gate
description: Run the project's CI-equivalent checks locally against the staged change, then report pass/fail and the diff against the ticket's acceptance criteria. Use when the user has staged their work and wants it checked before committing, or asks to run the gate, check it like CI, or get ahead of CI failures.
argument-hint: "[--plan | --all]   e.g. /gate, /gate --plan"
allowed-tools:
  - Bash(python3 ${CLAUDE_SKILL_DIR}/gate.py *)
  - Bash(python3 ${CLAUDE_SKILL_DIR}/workflow.py *)
---

# Gate

**Where this sits:** the user has already hand-tested the feature, read the diff themselves,
and staged exactly what they intend to commit. The gate is the last step before a commit is
proposed: a machine check over a human-approved change, not a substitute for either.

**Never stage, commit or push.** Report and stop. The only file this skill may write is the
`gate` block of the workflow config in step 0, and only on the user's yes.

Settings come from `.claude/workflow.json` (the team's) and `.claude/workflow.local.json`
(the user's, git-ignored), shared with `/next`, `/prep-branch`, `/commit-pr` and `/pr-comments`.
`python3 ${CLAUDE_SKILL_DIR}/workflow.py` prints the merged result. If `rulesFile` is set, read
that file first: its rules about checks, what counts as CI parity, and reporting win over this
skill's defaults.

## 0. Set up the jobs, if there are none

`gate.py` exits 2 with `No gate jobs configured` when `gate.jobs` is empty, and with
`invalid gate config: …` when a job is malformed. For the second, show the error and fix the
block with the user. For the first, build the block from the project's CI:

1. Read the CI definitions: `.github/workflows/*.yml` (and any reusable workflows they call),
   or `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `Jenkinsfile`,
   `bitbucket-pipelines.yml`. Read-only.
2. For each CI job, decide whether it can run on this machine. A job that builds or boots a
   container, needs secrets, cloud credentials, a deploy target or a service the user won't
   have running goes in `notLocal` by its CI name. The rest become gate jobs, one per command
   that matters, in the order CI runs them:
   - `run`: the command, as CI runs it (keep flags like a Release configuration; they're
     there for a reason). Leave out setup steps (`actions/setup-node`, checkout, caching).
   - `cwd`: the job's `working-directory`, relative to the repo root.
   - `paths`: what should trigger it. Use the workflow's `on: … paths:` filters if it has
     them, else the directory the job works in. Include the CI files the job depends on when
     a change there could break it.
   - `onlyIf`: for slow install steps such as `npm ci`, the lockfiles that make them worth
     re-running locally.
   - `ci`: the CI job's name, so the trailer can say which CI jobs were mirrored.
   The README has the full shape and an example.
3. Show the proposed block, say which CI jobs went to `notLocal` and why, and ask whether it
   goes in `.claude/workflow.json` (shared with the team, committed like any other change) or
   `.claude/workflow.local.json` (just this machine). A `gate` in the local file replaces the
   team's `jobs` and `notLocal` lists wholesale.
4. Write it only on a yes. Keep every other key in the file as it was. For the local file,
   check `git check-ignore -q .claude/workflow.local.json`; if it isn't ignored, say so and
   offer to add it to `.git/info/exclude` (its own yes). Then go on to step 1.

## 1. Run it

```bash
python3 ${CLAUDE_SKILL_DIR}/gate.py            # scope from staged files
python3 ${CLAUDE_SKILL_DIR}/gate.py --plan     # show the jobs and their commands, run nothing
python3 ${CLAUDE_SKILL_DIR}/gate.py --all      # scope from the whole working tree
```

It refuses to run with an empty index: staging *is* the declaration of intent. If the user
hasn't staged yet, say so rather than reaching for `--all`.

The jobs are shell commands from the repo's config, so whoever commits to `workflow.json`
decides what runs. If the `gate` block wasn't written in this session and you haven't seen
its commands, or `git diff --cached -- .claude/` shows it changing, run `--plan` first and
show the commands before running them.

It picks the jobs whose `paths` match a staged path, runs them in config order, stops at the
first failure and exits non-zero. A job with `onlyIf` is skipped, with a note, unless one of
those paths changed too.

## 2. Read the drift warning: this is the part that matters

The jobs read the **working tree**, not the index. If files in a tested area are unstaged or
untracked, the gate checked something slightly different from what will be committed, and the
script lists them under `WARNING: UNSTAGED/UNTRACKED changes in tested areas`.

Two reasons that list is rarely empty:

- **Another session's work.** Concurrent sessions can share one working tree. A session
  writing docs, glossary entries or notes for its own ticket leaves changes that don't belong
  in this commit. Name them and say to keep them out.
- **Machine-local edits** to tracked files, hidden with `skip-worktree`. These never show as
  changes; the script lists the ones in tested areas under a `skip-worktree` note, and
  `git ls-files -v | grep '^S'` lists them all. The jobs ran against the local versions.

Never resolve drift by staging more. The user decides what goes in the commit.

## 3. Check the acceptance criteria: the script can't do this

Find the originating ticket(s): the issues the branch's PR closes
(`gh pr view --json closingIssuesReferences`), else the number in the branch name
(`<branchPrefix><n>-<slug>`), else ask. Then compare the staged diff against each criterion:

```bash
gh issue view <n> --comments
git diff --cached
```

Report **per criterion**: met / partial / not met, each with the file or test that satisfies
it. A criterion satisfied only by manual testing counts as met (the user has already done
that pass), but say which ones rest on it, since nothing in CI will catch a regression there.

## 4. Report

```
GATE: <n> job(s), <all passed | k failed>
  PASS  web: lint, web: type-check, web: test, api: test
  NOT RUN LOCALLY  image, e2e

DRIFT  <files, or "none">

ACCEPTANCE: #412
  ✅ <criterion>: <what satisfies it>
  ⚠️ <criterion>: partial, <what's missing>

VERDICT  <ready to commit | fix X first>
```

Honesty rules: never summarise a partial run as a pass; never call it full CI parity when
`notLocal` lists anything, or when a CI job has no gate job at all; paste real output for any
failure. If no configured job covered the staged paths, say nothing was verified.

## 5. Hand back

If green, offer the trailer the script drafts, for example:

```
Verified: 4 local CI job(s) pass (web, api); image, e2e not run locally.
```

Then stop. The user stages nothing further, commits when ready, and the PR targets the trunk
(`trunk` in the workflow config); `/commit-pr` opens it.
