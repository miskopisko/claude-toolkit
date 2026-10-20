# manual-test-plan

Part of [claude-toolkit](../../README.md). See there for everything else in it and how to add the marketplace.

Builds a manual test plan for the ticket you're working on, as a web page you work through by hand before committing. Each step gets marked done and each check pass or fail, every section takes notes, and **Copy results** gives you a summary to paste back to Claude.

```
/manual-test-plan:manual-test-plan          # the ticket of the branch you're on
/manual-test-plan:manual-test-plan 412      # a specific ticket
```

You can also just ask Claude to "write a manual test plan for this".

## Install

```
/plugin marketplace add miskopisko/claude-toolkit
/plugin install manual-test-plan@miskopisko
```

For GitHub issues, install [`gh`](https://cli.github.com/) and run `gh auth login`. For another tracker, connect its connector in Claude Code, or paste the spec when asked.

## How it works

1. **Finds the ticket** from the argument, the branch's PR, or the branch name.
2. **Writes the cases blind.** A subagent that never sees the code or the diff writes the test cases from the ticket, its linked issues and the project's docs. The cases test the change against what was asked, not against what was built. Where the spec is unclear, the page lists questions to settle.
3. **Fills in the practical details** from the code: how to start the app and the URLs. It never changes what a check expects. A spec and code that disagree become a question on the page.
4. **Writes the API requests** to a `.http` file next to the page: one named request per case, matching the step that runs it. There are no `curl` commands to piece together.
5. **Picks real records** from your local database, with read-only queries, so each case names a record to use. Credentials are read from the project's local config and never written anywhere.
6. **Builds the page** in `.manual-tests/` at the repository root, git-ignored through `.git/info/exclude`, and opens it.

It never edits code or tracked files, commits, or writes to a database. Everything it writes stays in `.manual-tests/`.

## The page

One self-contained HTML file with no external dependencies. It follows your system's light or dark theme and keeps your ticks and notes in the browser, so you can close it and come back. Each plan is also saved as JSON next to its page. [`PLAN-FORMAT.md`](PLAN-FORMAT.md) describes it, and [`template.html`](template.html) renders it.

## Requirements

`bash` and `git`, on Linux or macOS. `gh` for GitHub issues. To run a generated `.http` file: VS Code with the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension, or a JetBrains IDE. The command-line client for your database (`psql`, `mysql`, `sqlite3`, …) or Docker, if you want real records picked.
