# claude-plugins

[Claude Code](https://claude.com/claude-code) plugins by
[@miskopisko](https://github.com/miskopisko), in one repository that is also a
plugin marketplace. Add the marketplace once, then install whichever plugins
you want.

## Plugins

| Plugin | What it does |
| --- | --- |
| [desk](plugins/desk) | A side pane for the branch you're on: its GitHub issue and acceptance criteria, its PR's checks, review and open threads, your local dev services (`/stack`), and a where-you-left-off note at each session start. |
| [session-stats](plugins/session-stats) | A live side pane of session stats: model, tokens, prompt cache and its savings, usage limits, cost and burn rate, tools and agents. Adds threshold alerts, a done notification, and [cache-tax](https://github.com/karanb192/cache-tax)'s keepwarm and cold-send guard. |

Each plugin's README covers what it shows, its commands and its settings.

## Install

At the Claude Code prompt, add the marketplace, then install a plugin by name:

    /plugin marketplace add miskopisko/claude-plugins
    /plugin install desk@miskopisko
    /plugin install session-stats@miskopisko

Or from a shell, in one step per plugin:

    claude plugin install desk --marketplace miskopisko/claude-plugins
    claude plugin install session-stats --marketplace miskopisko/claude-plugins

To pick up new versions later:

    /plugin marketplace update miskopisko

`/plugin` with no arguments opens a browser of everything in the marketplace.

## Your data and credentials

No plugin here ships with credentials, accounts, or anyone's personal
settings, and none sends data to a third-party service.

- **desk** reads GitHub through your own [gh CLI](https://cli.github.com)
  login (`gh auth login`), so it never sees or stores a token. Per-project
  service commands live in `.claude/desk.json` in your repo, and desk runs none
  of them until you approve them with `/stack trust`.
- **session-stats** needs nothing set up. Its numbers come from Claude Code
  itself.

Anything a plugin remembers (settings, the last GitHub read, your last prompts
per repository) is kept in Claude Code's per-plugin store under your own
Claude Code configuration directory, and stays on your machine.

If a plugin added here later needs a key or an account, it must ask for it on
install or first use and keep it in that store or in your OS keychain, never
in this repository.

## Layout

```
.claude-plugin/
  marketplace.json      the marketplace: lists every plugin and where it lives
plugins/
  <name>/
    .claude-plugin/
      plugin.json       the plugin's manifest: name, version, description
    hooks/              the plugin's code (hooks.json names the entry module)
    tests/              tests, run with `claude plugin test .`
    types/              types for the plugin's state
    README.md           what it does and how to use it
```

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
3. Add a row to the table above.
4. Run `claude plugin validate .` at the root and in the plugin folder, and
   `claude plugin test .` in the plugin folder.
5. Bump a plugin's `version` in its `plugin.json` whenever you change it, so
   `/plugin marketplace update` delivers it.

Before committing, check that nothing personal went in: no tokens, no
absolute paths from your machine, no hard-coded user names, emails or
organization names. A plugin that needs any of these asks for them at first
use.

## History

desk and session-stats each started in a repository of their own
(`miskopisko/claude-desk` and `miskopisko/claude-session-stats`). Their
commit history was carried over here, under `plugins/<name>/`.

## License

[MIT](LICENSE). session-stats includes code ported from
[cache-tax](https://github.com/karanb192/cache-tax), Copyright (c) 2026 Karan
Bansal, also MIT: see
[plugins/session-stats/LICENSE-cache-tax](plugins/session-stats/LICENSE-cache-tax).
