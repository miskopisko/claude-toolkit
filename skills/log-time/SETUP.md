# First-time setup for log-time

The goal is a config file at `${XDG_CONFIG_HOME:-$HOME/.config}/log-time/config.json`, shaped like `config.example.json` in this skill folder. Do the lookups yourself and ask the user only to confirm or fill gaps. If a config already exists (re-running `setup`), start from its values and show what changes.

1. **Prerequisites.** Check that `git config --global user.email` is set and that the Harvest tools respond. If `gh` isn't installed or `gh auth status` fails, say that GitHub PRs and issue titles will be missing until it's set up, and go on.

2. **Harvest user.** Call `list_users` with `search` set to the git email. If exactly one user matches, use their id. Otherwise show the candidates and ask.

3. **Where the code lives.** Find candidate folders: `find ~ -maxdepth 4 -type d -name .git -not -path '*/.*/*' -not -path '*/node_modules/*'`. Group the results by their top folder (for example `~/code`, `~/work`). Ask which of these to scan; those become `scan_roots`.

4. **Map repos to projects.** Fetch the user's Harvest entries from the last 90 days (`list_time_entries` with their `user_ids`), and the active projects (`list_projects` with `is_active: true`). For each repo or group of repos under the scan roots, propose a project and task, choosing them by:
   - the client or project name appearing in the repo path or remote URL
   - the project and task the user logs to most often
   
   Show all the proposals in one table. The user confirms, corrects, or marks a repo `skip` (personal projects, open-source clones, tools). Use a folder glob such as `~/work/client-a/*` when every repo in a folder goes to the same project. Leave repos the user isn't sure about out of the file; the main skill asks about them the first time they show up.

5. **Defaults.** Ask for the usual hours per day (default 8) and the country or region for holidays.

6. **Write the file.** Create the folder if needed and write the JSON. Show where it went and summarize it in a few lines.
