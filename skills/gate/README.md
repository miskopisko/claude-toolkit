# gate

Part of [claude-toolkit](../../README.md). See there for everything else in it and how to add the marketplace.

Runs your project's CI checks locally against what you've staged, before you commit. It picks the jobs the staged paths touch, stops at the first failure, warns when unstaged files could make the result differ from the commit, then checks the change against the ticket's acceptance criteria and drafts a `Verified:` trailer for the commit message.

```
/gate          # check what's staged
/gate --plan   # show which jobs would run, and their commands, without running them
/gate --all    # scope from every working-tree change, not just what's staged
```

You can also just ask Claude to "run the gate" or "check this like CI would".

It never stages, commits or pushes. The first time, with no jobs configured, Claude reads your CI workflows, proposes the jobs and writes them to your config only when you say yes. It runs no job until you've trusted the commands (see [Trust](#trust)).

## Install

```
/plugin marketplace add miskopisko/claude-toolkit
/plugin install gate@miskopisko
```

Install [`gh`](https://cli.github.com/) and run `gh auth login`, for reading the ticket.

## Settings

gate is one of five workflow skills (`/next`, `/prep-branch`, `/gate`, `/commit-pr` and `/pr-comments`) that share one config file: `.claude/workflow.json` at the repository root, committed for the team, with `.claude/workflow.local.json` beside it for your own, git-ignored overrides. Keys in the local file win, one level deep, so a `gate` there replaces only the keys it sets: a local `jobs` replaces the team's whole `jobs` list and keeps the team's `notLocal`, unless it sets that too.

gate uses:

- `gate.jobs`: the checks to run, in order.
- `gate.notLocal`: names of CI jobs that can't run on your machine (container builds, deploys, anything needing secrets). The report lists them as not run, and the trailer says so.
- `rulesFile`: a doc of house rules, read first if set. Its rules win over the skill's defaults.
- `branchPrefix`: to find the ticket number in the branch name.
- `trunk`: the branch the PR will target, mentioned in the hand-back.
- `repo`: where to read the ticket. By default it's resolved from the `remote` setting (default `origin`), the git remote for the shared repo; in a fork set `remote` to `upstream`.

Each job is:

| Key | Type | | Meaning |
| --- | --- | --- | --- |
| `name` | string | required | What the report calls it, e.g. `"web: lint"`. |
| `run` | string | required | A shell command, run with `sh -c`. Exit 0 passes. |
| `paths` | list of globs | required | The job runs when any in-scope path matches one. |
| `cwd` | string | optional | Where to run it, relative to the repo root. Default: the root. |
| `onlyIf` | list of globs | optional | Also require one of these to have changed, e.g. a lockfile for `npm ci`. Otherwise it's skipped with a note. |
| `ci` | string | optional | The CI job it mirrors. The trailer names these. Default: `name`. |

Globs match paths from the repo root. `*` and `?` stay inside one directory and `**` crosses them. A glob ending in `/` matches everything under that directory, and one with no `/` matches a file name at any depth (`package-lock.json`).

For a repo with a frontend in `web/`, a Python API in `api/` and some CI scripts:

```json
{
  "gate": {
    "jobs": [
      { "name": "web: npm ci", "ci": "web", "cwd": "web", "paths": ["web/"],
        "onlyIf": ["web/package.json", "web/package-lock.json"], "run": "npm ci" },
      { "name": "web: lint", "ci": "web", "cwd": "web", "paths": ["web/"], "run": "npm run lint" },
      { "name": "web: type-check", "ci": "web", "cwd": "web", "paths": ["web/"], "run": "npm run type-check" },
      { "name": "web: test", "ci": "web", "cwd": "web", "paths": ["web/"], "run": "npm test" },
      { "name": "api: test", "ci": "api", "cwd": "api", "paths": ["api/", "pyproject.toml"],
        "run": "python3 -m pytest -q" },
      { "name": "scripts: test", "ci": "scripts", "paths": ["scripts/", ".github/"],
        "run": "python3 -m unittest discover -s scripts/tests" }
    ],
    "notLocal": ["image", "e2e"]
  }
}
```

## Trust

Each `run` is a shell command, and anyone who can commit to `workflow.json` decides what they are. So the gate runs a `gate` block only after you've approved it on this checkout:

1. The first time, or whenever the block changes (an edit to either config file, or a pull that brings one in), the gate runs nothing. It prints every job and its command and exits 3.
2. Claude shows you those commands, points out anything unusual and any job that wipes installed dependencies (`npm ci`, `uv sync`, …), and asks.
3. Only on your yes does it run `gate.py --trust`, which records the block's sha256 fingerprint and runs nothing. Claude Code asks your permission for that command too. Then the gate runs normally.

Fingerprints are kept one per line in the file `git rev-parse --git-path gate-trusted` names (normally `.git/gate-trusted`, so per clone and per worktree, never committed). Delete it to forget every approval. `--plan` runs nothing either way and says whether the block is trusted, and it works with nothing staged.

## How it works

1. **Refuses an untrusted block** (see [Trust](#trust)), **and an empty index.** Staging is how you say what the commit is. `--all` is there for when you mean the whole working tree, and `/pr-comments` uses it to check fixes it hasn't staged.
2. **Picks the jobs** whose `paths` match the staged files and runs them in config order, stopping at the first failure.
3. **Warns about drift.** The jobs read the working tree, not the index, so unstaged or untracked files in a tested area mean the gate checked something a little different from the commit. It lists them, and any `skip-worktree` files in tested areas, whose local edits never show as changes. If concurrent sessions share the working tree, some of these may be another session's work. Claude never fixes drift by staging more.
4. **Checks the acceptance criteria.** Claude reads the ticket (from the branch's PR or the branch name) and reports each criterion as met, partial or not met, with what satisfies it.
5. **Reports honestly.** A partial run is never a pass, the CI jobs in `notLocal` are named as not run, and failures come with their real output. When everything passes it drafts a trailer:

   ```
   Verified: 4 local CI job(s) pass (web, api); image, e2e not run locally.
   ```

Then it stops. You commit when ready, and `/commit-pr` opens the PR against the trunk.

## Requirements

Python 3 and `git`, on Linux or macOS. `gh` for reading the ticket, from the repo the `remote` setting names (default `origin`). Whatever your jobs run (`npm`, `pytest`, `dotnet`, …).
