# log-time

Part of [claude-toolkit](../../README.md). See there for everything else in it and how to add the marketplace.

Logs your day to [Harvest](https://www.getharvest.com/). It reads your git commits and GitHub PRs for the day, works out which tickets you touched, writes one line of notes per ticket, and logs the hours after you approve a preview.

```
/log-time:log-time                  # today, default hours
/log-time:log-time yesterday        # catch up on a missed day
/log-time:log-time 2026-10-14 6h    # a specific date and hours
/log-time:log-time setup            # (re)run first-time setup
```

You can also just ask Claude to "log my time for today".

## Install

```
/plugin marketplace add miskopisko/claude-toolkit
/plugin install log-time@miskopisko
```

Then:

1. Connect the **Harvest** connector in Claude Code (`/mcp`).
2. Make sure your git email is set (`git config --global user.email`, or per repo). To get PR and issue titles, install [`gh`](https://cli.github.com/) and run `gh auth login`.
3. Run `/log-time:log-time setup`. It finds your Harvest user, the folders your repos live in, and which Harvest project each repo bills to, then asks you to confirm. If you skip this, it runs on first use.

## Your settings

Setup writes `~/.config/log-time/config.json` (or `$XDG_CONFIG_HOME/log-time/config.json` if you set that). It lives outside the plugin, so updates never overwrite it and nothing personal is shared. [`config.example.json`](config.example.json) shows the format:

| Field | Meaning |
|---|---|
| `harvest_user_id` | Your Harvest user id |
| `default_hours` | Hours logged when you don't give a number |
| `holiday_region` | Country or region whose holidays it warns about |
| `scan_roots` | Folders to search for git repos |
| `repos` | Rules mapping repo paths (globs, `~` allowed) to a Harvest project and task, or `"skip": true` |

When it finds work in a repo with no rule, it asks where that repo bills and saves the answer.

## How it works

1. Checks Harvest for that date. If an entry already exists, it stops and asks.
2. Runs [`day-activity.sh`](day-activity.sh), which lists your commits and the GitHub PRs you were involved in that day.
3. Groups that activity into tickets and asks about work that isn't in git, such as meetings.
4. Shows a preview: one entry per Harvest project, with the hours split if you worked on more than one project.
5. Logs the entry only after you say yes. It never submits the timesheet for approval unless you ask.

## Requirements

`bash` and `git`, on Linux or macOS, and optionally `gh`.
