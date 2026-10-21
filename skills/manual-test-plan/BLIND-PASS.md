# Writing the test cases from the spec alone

You are writing manual test cases for one ticket. A person will work through them by hand, in a browser and an API client, to check the change before it is committed.

**Write from the spec and documentation only.** The point is a test plan that checks the code against what was asked, so it must not be shaped by the code. Do **not** read source code, tests, migrations, build files, the git diff or the branch's commits, and don't search the code. If you see code by accident, don't use it. Where you need a practical detail that only the code would give (a URL, a route, a field name, how to start the app), write a `{{…}}` placeholder and move on.

## What you may read

- The ticket: title, body, comments, and the issues it links to, its parent and its sub-issues. For GitHub, `gh issue view <n> --comments`, run in the repository, and the same for linked issues.
- Prose documentation: `README*`, `CONTEXT.md` or any glossary, `docs/`, ADRs, specs, and other Markdown or text that describes behaviour. Read what is relevant to the ticket, not everything.
- Anything the person who asked has pasted as the spec.

## What to write

Write the plan as JSON in the shape `PLAN-FORMAT.md` describes (read it first), to the path you were given. Fill in `ticket`, `title`, `url`, `summary`, `sources`, `questions`, `needs` and `sections`. Leave `key`, `facts`, `related`, `environment` and `generated` to the logistics pass.

Sections, in this order:

1. **`0 · Setup`**: get the app into the starting state. Use placeholders for how to start it and which records to use.
2. **Scenarios**, numbered from 1. Each is one thing a person can do start to finish: steps, then the checks that prove it. Cover:
   - every acceptance criterion, each one with at least one check (name the criterion in the section intro when the ticket lists them);
   - the main paths, then boundaries and edge values, invalid input, empty and missing data;
   - each role or permission the spec mentions, including being refused;
   - what is saved: reload the page and check it is still so; check history or audit entries the spec mentions;
   - races and stale data if the spec mentions concurrency, versions or recalculation;
   - API behaviour (status codes, error messages) when the spec states it. Put each API call in the step's `requests` array as a placeholder saying what the request does, e.g. `"requests": ["{{request: remove the override with a stale value, as an Editor}}"]`, and follow the step with a check for the response. Don't name or describe the requests in the step's `text`. A step is done either by hand or by requests, never both: when an action mixes them (a request, then something in the app, then another request), make it one step per stretch, in order, each saying what it does and why. One request per case, including each one that should be refused. The logistics pass turns these into named requests.
3. **`Regression`**: neighbouring behaviour the spec or docs say must keep working.
4. **`Cleanup`**: put any data the run changed back the way it was.

Writing each item:

- A step is an action and the reason for it: "Set the quantity to [[0]], the lowest value the spec allows", "Put the claim in conflict, so the override has a newer value to clash with". Lead with what it achieves; keep the how to a short clause after it. A check is something visible: on screen, in an API response, in a downloaded file, in the history.
- A check states the exact expected result from the spec: the value, the message, the status code. If the spec gives inputs and a rule, work out the expected value and show the arithmetic in the section intro. Never write "works correctly" or "behaves as expected".
- Use the project's own words for things, from its glossary and docs.
- Keep each section short enough to do in a few minutes. Split long ones.
- Each section stands on its own. When it needs an action an earlier section already did (restore a record, sign in as another role, run the same request), write the step out again in full, with its own placeholder. Never write "repeat step 3b", "same as 3b" or "run the request from section 3".
- Say what data a case needs in `needs` ("an order that is already shipped", "a user with no orders") and refer to it in the items through a placeholder.

**Questions.** When the spec is silent, vague or contradicts itself about something a check depends on, add an entry to `questions` and write the check against the most likely reading, saying so in the item. Don't invent requirements.

When you're done, reply with the path you wrote, the number of sections and checks, and the questions.
