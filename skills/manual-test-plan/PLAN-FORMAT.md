# The plan file

A plan is one JSON file. `build-page.sh` puts it into `template.html`, which renders it. Every field except `sections` is optional.

```json
{
  "key": "shop-web/412-csv-export",
  "ticket": "#412",
  "title": "Export the reports table as CSV",
  "url": "https://github.com/acme/shop-web/issues/412",
  "environment": "local",
  "generated": "2026-10-19",
  "summary": "The reports page gets an **Export CSV** button that downloads the rows currently shown, with the filters applied.",
  "sources": ["Issue #412 and its comments", "Parent issue #400", "`docs/reports.md`", "`CONTEXT.md` (glossary)"],
  "facts": [
    { "label": "Report", "text": "[[Monthly sales]] · [open it](http://localhost:3000/reports/17)" },
    { "label": "User", "text": "`viewer@example.test` (role **Viewer**) for the permission checks" },
    { "label": "Requests", "text": "[412-csv-export.http](412-csv-export.http): run in VS Code (REST Client) or a JetBrains IDE; paste a token into `@token` first" }
  ],
  "related": [{ "label": "#398 test plan", "href": "398-report-filters.html" }],
  "questions": [
    "The spec says the file is named after the report but not what happens to characters like `/` in the name."
  ],
  "needs": ["a report with more than 1,000 rows"],
  "sections": [
    {
      "id": "setup",
      "title": "0 · Setup",
      "intro": "Start the app on this branch and sign in as an **Editor**.",
      "items": [
        { "kind": "step", "text": "Start the stack: `npm run dev`." },
        { "kind": "check", "text": "The reports page shows the **Export CSV** button." }
      ]
    },
    {
      "id": "filtered",
      "title": "1 · Export respects the filters",
      "items": [
        { "kind": "step", "text": "Filter by region **North**." },
        { "kind": "step", "text": "Click **Export CSV**." },
        { "kind": "check", "text": "The file has [[42]] data rows, all with region `North`." },
        { "kind": "step", "text": "Run **1a · Export a report you can't see** in the requests file." },
        { "kind": "check", "text": "It's refused with **403**." }
      ]
    }
  ]
}
```

## Fields

| Field | Meaning |
|---|---|
| `key` | Where the page keeps ticks and notes in the browser: `<repo>/<file name without .html>`. Keep it the same when regenerating a page, unless the sections changed, in which case add `-v2`, `-v3` so stale ticks don't land on the wrong items. |
| `ticket`, `title`, `url` | Shown in the header. `url` links the ticket. |
| `environment` | Where the run happens, e.g. `local`. |
| `generated` | The date, `YYYY-MM-DD`. |
| `summary` | One or two sentences on what changed, **from the spec**. |
| `sources` | Every document the cases came from. |
| `facts` | Label/text rows at the top: the records to use, links, accounts, the API client. |
| `related` | Other test plans in the same folder, linked by file name. |
| `questions` | Gaps and contradictions to settle. Rendered as their own section. |
| `needs` | Data the cases need. The blind pass fills this in. The logistics pass turns each need into a fact (a record to use) or, when nothing fits, keeps it as a fact that says what to create. Not rendered. |
| `sections` | The tests, in order. |

A section has a unique lowercase `id` (letters, digits, `-`; any word is fine, including `questions`, since the page keeps them apart from its own elements), a `title`, an optional `intro` and `items`. An item has a `kind`, `"step"` (something to do, marked done) or `"check"` (something to observe, marked pass or fail), its `text`, and an optional `snippet` (`label`, `text`) shown with a Copy button, for a command or query to run. API calls are named requests in the plan's `.http` file, never snippets or `curl` commands.

## Text

All text is plain text with a little markup. Anything else, including HTML, shows as written.

| Write | For |
|---|---|
| `` `code` `` | names, paths, commands, field names |
| `**bold**` | buttons, menu items, roles, status codes |
| `[[value]]` | an exact expected value: an amount, id, count, message |
| `~~struck~~` | a value shown struck through on screen |
| `[label](url)` | a link (`http(s)://…`, another `.html` plan in the folder, or the plan's `.http` file) |

## Placeholders

The blind pass writes `{{…}}` where it lacks a practical detail, saying what is needed, e.g. `{{url: the reports page}}`, `{{record: a report with more than 1,000 rows}}`, `{{how to start the stack}}`, `{{request: export report 99 as a Viewer}}`. The logistics pass replaces every one. `build-page.sh` warns about any that are left.
