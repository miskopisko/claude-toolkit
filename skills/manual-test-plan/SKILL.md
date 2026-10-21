---
name: manual-test-plan
description: Build a manual test plan for the ticket being worked on, as a web page the user works through by hand, ticking each check pass or fail. The test cases come from the ticket spec and project docs, not the code, and use real records from the project's local database when there is one. Use after implementing a feature or fix and before committing, or when the user asks for manual test cases, a test plan, or a checklist to test a change by hand.
argument-hint: "[ticket]   e.g. /manual-test-plan, /manual-test-plan 412, /manual-test-plan <issue url>"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/build-page.sh *)
---

# Build a manual test plan

The result is one HTML page in `<repo>/manual-tests/`, opened in the browser. The user works through it at their own pace: steps get marked done, checks pass or fail, each section takes notes, and **Copy results** gives a summary to paste back here.

This skill only reads, apart from its own files in `manual-tests/`. Never edit code or tracked files, stage, commit, or write to a database while running it.

## 1. Find the ticket

Use the argument if there is one: a number, `#412`, `PROJ-123` or a URL. Otherwise, in this order:

- the first issue the branch's PR closes: `gh pr view --json closingIssuesReferences`;
- the number in the branch name (`feature/412-…`, `fix/398_…`, `PROJ-123-…`).

If none of these gives a ticket, or more than one is plausible, ask. For a GitHub issue, `gh issue view <n>` must work. For another tracker, use its connector if one is available; otherwise ask the user to paste the spec.

Name the page `<ticket>-<short-slug>`, e.g. `412-csv-export` or `PROJ-123-login-lockout`. The plan file is `manual-tests/<name>.json`, the page `manual-tests/<name>.html` and any requests file `manual-tests/<name>.http`, all under the repository root.

Make sure `manual-tests/` is ignored without touching tracked files. From the repository root, run this. It adds `/manual-tests/` to the repository's `info/exclude` only if the line isn't there yet, so it's safe to run every time:

```sh
f=$(git rev-parse --git-path info/exclude) && mkdir -p "$(dirname "$f")" &&
  { grep -qxF '/manual-tests/' "$f" 2>/dev/null ||
    { [ -s "$f" ] && [ -n "$(tail -c1 "$f")" ] && echo >> "$f"; echo '/manual-tests/' >> "$f"; }; }
```

Earlier versions wrote to a hidden `.manual-tests/` folder. If one exists, leave it alone: don't move, copy or delete it, and don't read its plans as `related`.

If a page with that name exists, ask whether to replace it (its ticks start over) or keep it and stop.

## 2. Write the cases blind

Hand this to a **subagent** (the Agent tool, general-purpose), because your own context likely holds the implementation and the cases must not be shaped by it. Its prompt gives only:

- the path `${CLAUDE_SKILL_DIR}/BLIND-PASS.md`, to read and follow, and `${CLAUDE_SKILL_DIR}/PLAN-FORMAT.md`;
- the ticket reference and the repository root;
- the plan path to write;
- anything the user pasted as the spec.

Don't describe the change, the files touched or how it was built. If no subagent is available, tell the user the cases can't be written blind in this session, and offer to go on anyway or stop.

## 3. Fill in the practical details

Read the plan. Now the code may be used, **for logistics only**: replace each `{{…}}` placeholder with the real detail.

- **Running it:** how to start what the plan needs, from the README, `docker-compose*.yml`, `package.json` scripts, `Makefile`, or `.claude/desk.json` (then it's `/stack up`).
- **Where to look:** the URLs and ports of the pages, from the routes and dev-server config.
- **API calls:** see step 3a. Never give `curl` commands.
- **Data:** see step 4.

Then set `key`, `environment`, `generated` and `facts`, and list other plans in `manual-tests/` for the same or linked tickets under `related`.

Rules for this pass:

- **Never change what a check expects.** If the code seems to disagree with the spec, leave the check as written and add a `questions` entry saying where they differ.
- Don't add, drop or reword cases because of what the code does. You may fix a step so it can be carried out (a button's actual label, a route).
- Don't put secrets on the page: no passwords, tokens or connection strings. Test account names are fine.

## 3a. API requests

Every API call in the plan is a named request in one `.http` file, `manual-tests/<name>.http` next to the page, so nothing has to be typed or pieced together by hand. Write it whenever the plan makes any API call, in the format both VS Code's REST Client and JetBrains' HTTP Client run. If the repository already has `.http` or `.rest` files, reuse their base URL, variables and auth setup so the file feels familiar, but don't edit them.

```http
# Requests for the #412 manual test plan: one block per section of the page,
# in the same order. Work down the block for the section you're on. A request
# a section needs again is repeated in it, so there's no scrolling back.
@baseUrl = http://localhost:3000
# Paste a token for the signed-in test user. This file is git-ignored.
@token =

### ━━━━━━━━━━━━━━━━ 1 · Viewers can't export ━━━━━━━━━━━━━━━━

### 1a · Export a report you can't see (expect 403)
# @name exportForbidden1a
GET {{baseUrl}}/api/reports/99/export.csv
Authorization: Bearer {{token}}

### ━━━━━━━━━━━━━━━━ 3 · Saved filters ━━━━━━━━━━━━━━━━

### 3a · Export with an empty filter (expect 400)
# @name exportEmptyFilter3a
POST {{baseUrl}}/api/reports/17/export
Authorization: Bearer {{token}}
Content-Type: application/json

{ "filters": { "region": "" } }

### 3b · Clear the saved filter (expect 204)
# @name clearFilter3b
DELETE {{baseUrl}}/api/reports/17/filters
Authorization: Bearer {{token}}

### ━━━━━━━━━━━━━━━━ C · Cleanup ━━━━━━━━━━━━━━━━

### Ca · Clear the saved filter (expect 204)
# @name clearFilterCa
DELETE {{baseUrl}}/api/reports/17/filters
Authorization: Bearer {{token}}
```

- **One block per section, in page order.** Open each block with a banner: a `###` line holding the section's number and title between `━` rules, and nothing else, so neither client sends it. Skip sections that make no API call.
- **A section's block holds every request that section runs, in the order its steps run them.** When a section needs a request again that an earlier one already has (restoring a record, signing in as another role), write it out again in full in this block. Never send the user to another section's request, and don't point back to it either: no `same as 3b` in titles, comments or the page.
- Title each request `### <section><letter> · <what it does> (expect <status>)`. `<section>` is the number its section's title starts with (`R` for Regression, `C` for Cleanup), and `<letter>` counts the requests within that block in order, repeats included: the first is `a`, the next `b`. Give it a `# @name` that ends with the same `<section><letter>`, so names stay unique when a request repeats.
- Put the base URL, record ids used more than once, and auth in variables at the top. Work out how to get a token from the README, docs or auth setup, and say how in the comment above `@token`. Never write a real secret into the file: leave values the user has to supply empty, with a comment.
- One request per call the plan makes, including each refused one, with the body that case needs. Don't rely on the user editing a request between steps; give each variant its own request.
- In the plan, the step's `text` says what it does and why, and its `requests` lists the titles of the requests that do it, in order, without the `(expect …)` part: `"requests": ["**1a** · Export a report you can't see"]`. Never put request names in the step text. A step with `requests` has nothing to do by hand; if requests and actions in the app alternate, split the step so each stretch is its own step, in order (see `PLAN-FORMAT.md`). The checks state what the response should be. Add a `facts` row linking the file: `[412-csv-export.http](412-csv-export.http)`, and say which clients run it.

## 4. Pick real records

If the project has a local data store, use it to find a record for each entry in `needs`.

- **Find it** from local config: `.env*`, `appsettings*.json`, `docker-compose*.yml`, `config/database.yml`, Prisma or ORM config. Use the matching client (`psql`, `mysql`, `sqlite3`, `mongosh`, `redis-cli`), or run it in the container (`docker compose exec <service> …`). Read credentials from the config at run time; never print or save them.
- **Only local databases.** If the host isn't `localhost`, `127.0.0.1` or a local container, ask before connecting.
- **Read only.** Only `SELECT`-style queries, with a `LIMIT`. Where the client supports it, make the session read-only too: `PGOPTIONS='-c default_transaction_read_only=on'` for Postgres, `START TRANSACTION READ ONLY` for MySQL, `-readonly` for sqlite3.
- Learn the schema from the database itself (`\d`, `information_schema`) or from migrations.
- Put what you found in `facts`: the record's id and name, its link, and the values the checks depend on. Where the expected values depend on the record, update the checks with the values it actually has, worked out from the spec's rule, and show the arithmetic in the section intro.
- When no record fits, add a fact saying what to create first, and how if the app can do it.

If the database isn't running or there isn't one, keep the `needs` as facts that describe the record to find, and say so in your report.

## 5. Build and open the page

Run `${CLAUDE_SKILL_DIR}/build-page.sh <plan.json> <page.html>`. Fix the plan if it reports invalid JSON. If it warns about placeholders left, fill them or, when a detail can't be found, turn the placeholder into a plain description of what's missing.

Open the page with `xdg-open` (Linux) or `open` (macOS). If neither works, give the path.

## 6. Report

In a few lines: the page's path, how many sections and checks it has, the records it uses, the requests file if one was written (and which values in it the user must fill in, such as a token), and the open questions. Tell the user to use **Copy results** and paste it here when they're done.

When they paste results back, go through each FAIL with their notes: find the cause and propose a fix. Don't change code until they say so. Answers to open questions go back into the plan; rebuild the page if they change a check.
