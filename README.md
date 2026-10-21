# claude-toolkit

[Claude Code](https://claude.com/claude-code) skills and plugins by
[@miskopisko](https://github.com/miskopisko), in one repository that is also a
plugin marketplace. Add the marketplace once, then install whichever ones you
want.

## What's here

**Plugins** add panes, commands and hooks to Claude Code itself.

| Plugin | What it does |
| --- | --- |
| [desk](plugins/desk) | A side pane for the branch you're on: its GitHub issue and acceptance criteria, its PR's checks, review and open threads, your local dev services (`/stack`), and a where-you-left-off note at each session start. |
| [session-stats](plugins/session-stats) | A live side pane of session stats: model, tokens, prompt cache and its savings, usage limits, cost and burn rate, tools and agents. Adds threshold alerts, a done notification, and [cache-tax](https://github.com/karanb192/cache-tax)'s keepwarm and cold-send guard. |

**Skills** teach Claude a task. Each one installs as a plugin of its own.

| Skill | What it does |
| --- | --- |
| [log-time](skills/log-time) | Logs a day's work to Harvest from the tickets in your git commits and GitHub PRs. |
| [manual-test-plan](skills/manual-test-plan) | Builds a manual test plan for the ticket you're on, as a web page to tick through: cases written from the spec, not the code, with real records from your local database. |

Each one's README covers what it does, its commands and its settings.

## Install

At the Claude Code prompt, add the marketplace, then install by name:

    /plugin marketplace add miskopisko/claude-toolkit
    /plugin install desk@miskopisko
    /plugin install session-stats@miskopisko
    /plugin install log-time@miskopisko
    /plugin install manual-test-plan@miskopisko

Or from a shell, in one step each:

    claude plugin install desk --marketplace miskopisko/claude-toolkit

To pick up new versions later:

    /plugin marketplace update miskopisko

`/plugin` with no arguments opens a browser of everything in the marketplace.

Run a skill by its name, for example `/log-time`, or just ask for the task
and Claude picks it up. Claude Code lists a plugin's skills as
`/<plugin>:<skill>` (here `/log-time:log-time`), but a skill that sets `name`
in its `SKILL.md`, as every skill here does, also answers to the bare name
unless another command already has it
([docs](https://code.claude.com/docs/en/skills)).

## Your data and credentials

Nothing here ships with credentials, accounts, or anyone's personal settings,
and nothing sends data to a third-party service you haven't connected
yourself.

- **desk** reads GitHub through your own [gh CLI](https://cli.github.com)
  login (`gh auth login`), so it never sees or stores a token. Per-project
  service commands live in `.claude/desk.json` in your repo, and desk runs none
  of them until you approve them with `/stack trust`.
- **session-stats** needs nothing set up. Its numbers come from Claude Code
  itself.
- **log-time** talks to Harvest through the Harvest connector you connect in
  Claude Code, and keeps your settings in `~/.config/log-time/`.
- **manual-test-plan** reads GitHub issues through your `gh` login, and picks
  test records from your local database with read-only queries, using the
  credentials in your project's local config without printing or saving
  them. It asks before connecting to any database that isn't local. All it
  writes goes in `manual-tests/` in your repo, which it keeps out of git with
  a line in `.git/info/exclude`.

Plugins keep what they remember in Claude Code's per-plugin store under your
own Claude Code configuration directory. Skills that need settings keep them in
`~/.config/<skill>/`. Either way it stays on your machine.

## Layout

```
.claude-plugin/
  marketplace.json      the marketplace: lists every plugin and skill and where it lives
plugins/
  <name>/
    .claude-plugin/
      plugin.json       the plugin's manifest: name, version, description
    hooks/              the plugin's code (hooks.json names the entry module)
    tests/              tests, run with `claude plugin test .`
    types/              types for the plugin's state
    README.md           what it does and how to use it
skills/
  <name>/
    SKILL.md            the skill
    README.md           what it does and how to use it
    …                   any scripts or reference files it uses
```

A skill has no `plugin.json`. Its entry in `marketplace.json` (with
`"strict": false`) carries its version and details, so the skill folder stays
a plain skill folder that also works copied into `~/.claude/skills`.

## Develop

Validate the marketplace from the repository root:

    claude plugin validate .

Validate and test one plugin from its folder:

    cd plugins/desk
    claude plugin validate .
    claude plugin test .

To try a local change, install from your checkout instead of GitHub:

    claude plugin install desk --marketplace ./

### Adding a plugin

1. Create `plugins/<name>/` with a `.claude-plugin/plugin.json` (`name`,
   `version`, `description`, `author`, `license`) and a `README.md`.
2. Add an entry to `.claude-plugin/marketplace.json`:
   `{ "name": "<name>", "source": "./plugins/<name>", "description": "…" }`.
3. Add a row to the plugins table above.
4. Run `claude plugin validate .` at the root and in the plugin folder, and
   `claude plugin test .` in the plugin folder.

### Adding a skill

1. Create `skills/<name>/` with a `SKILL.md` (frontmatter `name` and
   `description`) and a `README.md`. Use the same `<name>` for the folder,
   the frontmatter and the marketplace entry.
2. In `SKILL.md`, refer to bundled files as `${CLAUDE_SKILL_DIR}/<file>`, so
   the skill works both installed and linked into `~/.claude/skills`.
3. Keep anything personal (ids, paths, tokens) out of the repository. Have the
   skill read it from `~/.config/<name>/` and create that on first run, with a
   `config.example.json` beside `SKILL.md` to show the shape.
4. Add an entry to `.claude-plugin/marketplace.json`:
   ```json
   { "name": "<name>", "source": "./skills/<name>", "strict": false, "skills": ["./"],
     "version": "0.1.0", "description": "…" }
   ```
5. Add a row to the skills table above and run `claude plugin validate .`.

To edit a skill you use every day and see changes at once, link it into your
personal skills instead of installing it (don't do both, or you'll have two
copies):

    ln -s "$PWD/skills/<name>" ~/.claude/skills/<name>

### Releasing

Bump the `version` whenever you change something (in `plugin.json` for a
plugin, in its `marketplace.json` entry for a skill). Users get a change only
when the version moves, so commits in between are safe to push.

Before committing, check that nothing personal went in: no tokens, no
absolute paths from your machine, no hard-coded user names, emails or
organization names.

## History

desk and session-stats each started in a repository of their own
(`miskopisko/claude-desk` and `miskopisko/claude-session-stats`), and log-time
in `miskopisko/claude-skills`. This repository was called `claude-plugins`
until the skills moved in.

## License

[MIT](LICENSE). session-stats includes code ported from
[cache-tax](https://github.com/karanb192/cache-tax), Copyright (c) 2026 Karan
Bansal, also MIT: see
[plugins/session-stats/LICENSE-cache-tax](plugins/session-stats/LICENSE-cache-tax).
