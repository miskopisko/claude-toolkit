---
name: log-time
description: Log a day's work to Harvest from the tickets worked on that day, found in git commits and GitHub PRs. Defaults to today and the configured hours (8 unless set otherwise). Accepts a past date ("yesterday", "monday", "2026-10-14"), an hours override ("6h"), or "setup" to (re)configure. Use when the user asks to log time, fill in Harvest, or do end-of-day time tracking.
argument-hint: "[date] [hours] | setup   e.g. /log-time, /log-time yesterday, /log-time 2026-10-14 6h"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/day-activity.sh *)
---

# Log a day's time to Harvest

Requires the Harvest MCP connector (tools such as `list_time_entries` and `log_time`). If those tools aren't available, tell the user to connect Harvest (in Claude Code: `/mcp`) and stop.

## 0. Load the config

All personal settings live in `~/.config/log-time/config.json` (or `$XDG_CONFIG_HOME/log-time/config.json`), never in this skill folder. Read it.

- If it doesn't exist, or the argument is `setup`, follow `${CLAUDE_SKILL_DIR}/SETUP.md` and then continue here, unless the argument was only `setup`.
- Its fields: `harvest_user_id`, `default_hours`, `holiday_region`, `scan_roots` (folders to search for git repos) and `repos` (rules that map repo paths to a Harvest project and task, or mark them `skip`). `${CLAUDE_SKILL_DIR}/config.example.json` shows the shape.

## 1. Work out the date and hours

- **Date:** use the date from the arguments; with no date, use today. Resolve relative words against today's date and weekday (`date "+%F %A"`). A bare weekday means its most recent past occurrence, never today or later. Never log to a future date.
- **Hours:** use the number from the arguments ("6h", "6.5", "4 hours"); otherwise use `default_hours`.
- If the date is a weekend or a statutory holiday in `holiday_region`, say so and ask before going on.

## 2. Check Harvest for that date first

Call `list_time_entries` with `from` and `to` set to the date and `user_ids: [harvest_user_id]`. If **any** entry exists for that day, **stop**. Show the existing entries (project, task, hours, notes) and ask what to do, such as add to them, replace their notes, or skip. Do nothing else until the user answers.

## 3. Collect the day's activity

Run `${CLAUDE_SKILL_DIR}/day-activity.sh <YYYY-MM-DD> <scan_roots...>`, quoting each root. It fetches each repo, then lists:
- the commits the user authored that day (matched on their git `user.email` and `user.name`, both the global ones and any set in each repo)
- for GitHub repos, the PRs they're involved in that were open that day, with their linked issues

Turn this into **tickets**:
- Get the ticket number from the PR title, the branch name (`feature/412-…`, `fix/398-…`, `PROJ-123-…`) or the commit message (`#412`, `PROJ-123`, `AB#398`).
- Match commits to PRs by subject or branch. Name each ticket by its issue title (for GitHub: `gh issue view <n> --json title` run in the repo) or else by its PR title.
- Drop PRs that had no commits, merges or reviews from the user that day. A PR that was merely open is not work.
- Merges into a shared branch (such as `main` or `develop`) count as part of the ticket they merged, not as a ticket of their own.
- Ignore repos whose matching rule says `skip`.

Then ask one short question: **"Anything else today that isn't in git, such as meetings, support or investigations?"** The user can answer "no". Add what they list as extra note lines.

## 4. Map repos to Harvest

Match each repo path against `repos[].match` (a path glob where `~` is the home folder). The first rule that matches wins.

If a repo with activity matches no rule, ask which project and task it belongs to, or whether to skip it. Use `list_projects` and `list_project_assignments` (`assignment_type: tasks`) to offer the choices. Then add the answer as a rule in the config file, so the next run knows it.

## 5. Build the entry

- **One entry per Harvest project for the day.** If all the work maps to one project, that project gets one entry with the full hours.
- If the work spans more than one project, propose a split of the hours based on how many commits each project had and when they were made, then ask the user to confirm or change it.
- **Notes:** one line per ticket, in this format:
  ```
  #412 - Add CSV export to the reports page
  #398 - Fix timezone offset in invoice dates
  Meetings
  ```
  List the ticket that had the most work that day first. When it adds clarity, put a short qualifier after the title, such as "(PR #415, in review)" or "(merged)". Don't list individual commits.
- If there's no git activity and the user reports nothing else, say so and ask whether to log anything at all. Don't invent notes.

## 6. Preview, then write

Show a preview table: date, project, task, hours and notes (the notes in a code block, exactly as they'll be saved). Ask **"Log this?"** Only after the user says yes, call `log_time` with `project_id`, `task_id`, `hours`, `spent_at` and `notes` for each entry. Then confirm with the created entry ids and that day's total hours.

Do not submit the timesheet for approval unless asked.
