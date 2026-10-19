# desk

Part of [claude-toolkit](../../README.md). See there for every plugin and how to add the marketplace.

A Claude Code side pane for the work on your current branch. In fullscreen
mode it docks on the right of the transcript.

It works in any git repository hosted on GitHub. Nothing in it is tied to one
project: the issue comes from your branch name or your PR, and the services
come from a small config file each project writes for itself.

## What it shows

- **Branch**: the branch, commits ahead of and behind its upstream, and the
  staged, changed and new files.
- **Issue**: the issue the branch works on, its state and its column on each
  GitHub project board, and its **acceptance criteria** as a progress bar
  and a checklist. The criteria are the checkboxes under the issue's first
  heading that says "acceptance"; with no such heading, every checkbox in
  the body counts.
- **Pull request**: the branch's PR, its review decision, its checks (passed,
  failed, running, and the names of the failing ones) and how many review
  threads are unresolved.
- **Services**: your local dev services, each up or down, with a key to
  start or stop it (see below).
- **Last session**: when you last worked in this repository, and your last
  prompts there.

The issue and PR numbers are links. `r` refreshes, `i` opens the issue and `p`
opens the PR in the browser. Click a key, or focus the pane (ctrl+x tab) and
press it.

### Where you left off

At the start of each conversation, desk hands Claude a short note the
transcript doesn't show: the branch and the state of the tree, the issue
with its unticked criteria, the PR's state, and your previous session's last
prompts and Claude's last answer. Ask "where did I leave off?" or "what's
next?" and Claude answers from it, with no digging. It goes with your first
prompt and isn't repeated. `/desk note off` turns it off.

## Install

At the Claude Code prompt:

    /plugin marketplace add miskopisko/claude-toolkit
    /plugin install desk@miskopisko

From a shell:

    claude plugin install desk --marketplace miskopisko/claude-toolkit

desk reads GitHub through the [gh CLI](https://cli.github.com), so install it
and run `gh auth login`. Project board columns need the `project` scope:
`gh auth refresh -s project`. Without gh, the pane still shows git and your
services.

## Use

The pane opens by itself when the terminal is at least 144 columns wide.

    /desk               open the pane (it docks on the right from 110 columns)
    /desk close         hide it
    /desk refresh       read git, GitHub and the services again
    /desk note on|off   the where-you-left-off note

The pane re-reads git and the services every 5 seconds while it's on screen,
and GitHub every 90 seconds, after each turn and whenever you switch branch.

### Which issue

desk takes the first issue the branch's PR closes (`Closes #12` in the PR, or
a linked issue). Without one, it reads the number in the branch name:
`implement/284-conflict-alert`, `feature/12_login`, `gh-7` and `123` all
work, and `bump-1.2.3` names none. A team with another scheme sets
`issuePattern` (below) to a regular expression whose first group is the number.

### Services

Each project lists its services in `.claude/desk.json`, committed so the team
shares it. `/stack init` writes one to start from:

```json
{
  "services": [
    {
      "name": "Database",
      "check": { "port": 5432 },
      "start": "docker compose up -d db",
      "stop": "docker compose stop db"
    },
    {
      "name": "API",
      "check": { "http": "http://localhost:5000/health" },
      "start": "dotnet run --project src/Api",
      "cwd": "."
    },
    {
      "name": "Web",
      "check": { "port": 5173 },
      "start": "npm run dev",
      "cwd": "web"
    }
  ],
  "issuePattern": "(?:^|/)(\\d+)-"
}
```

- `check` says how to tell the service is up: `{ "port": 5432 }` (and
  optionally `"host"`), `{ "http": "<url>" }` (any answer is up), or
  `{ "command": "<shell>" }` (exit 0 is up). Without one, a service is up
  while the process desk started is alive. For an https dev server with a
  self-signed certificate, check its port.
- `start` runs in the background, detached from Claude Code, so the service
  keeps running when you quit. Its output goes to `.git/desk/<name>.log`.
- `stop` is optional. Without it, desk stops the whole process group it
  started (a `dotnet run` and its children, say). A service desk didn't
  start needs a `stop` command to be stopped from desk.
- `cwd` is relative to the repository.

Your own services, or your own version of a team one, go in
`.claude/desk.local.json` (keep it out of git). It has the same shape, and
its services replace the team's by name.

    /stack              each service and whether it's up
    /stack up [name…]   start the named services, or every one that's down
    /stack down [name…] stop the named services, or every one desk can stop
    /stack logs <name>  the last lines of a service's log
    /stack trust        allow the commands in this project's config
    /stack init         write a .claude/desk.json to start from

**Trust.** A config file comes with the repository, so desk runs none of its
commands (start, stop, or a check command) until you've read it and run
`/stack trust`. Port and URL checks need no trust. When either file changes,
desk asks again.

## Notes

- Everything desk keeps (your last prompts per repository, the last GitHub
  read, trust, the processes it started) stays in its own store under your
  Claude Code configuration directory. Nothing is sent anywhere but GitHub,
  through your own gh.
- Where an organization manages Claude Code, the note still works: it rides
  on your first prompt rather than on the session's opening context.

## Develop

The hooks module is `hooks/register.tsx`. git is read in `hooks/git.ts`,
GitHub in `hooks/github.ts`, services in `hooks/stack.ts`, and the trail and
the note are built in `hooks/trail.ts`. The pane's state types are in
`types/index.d.ts`.

    claude plugin validate .
    claude plugin test .
