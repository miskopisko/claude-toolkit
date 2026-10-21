# session-stats

Part of [claude-toolkit](../../README.md). See there for every plugin and how to add the marketplace.

A Claude Code side pane with live stats for the current session. In fullscreen
mode it docks on the right of the transcript.

It also includes [cache-tax](https://github.com/karanb192/cache-tax): it keeps
the one-hour prompt cache warm during breaks, and stops a send that would
re-write a cold cache once, showing what it would cost. If you have cache-tax
installed separately, uninstall it so the guard doesn't run twice.

## What it shows

- **Session**: the model in use and its effort level, whether Claude is idle or
  working (with elapsed time and step), uptime, turns and the last turn's
  length, compactions, cost in dollars, and the burn rate: cost over the last
  hour, idle time included.
- **Context**: how full the context window is, as a bar, with tokens used,
  window size and free space.
- **Usage limits**: the 5-hour and 7-day windows, each a bar with its percent
  used (subscription accounts only).
- **Tokens**: new input, cached input, cache writes, output and request counts,
  for the main session and for agents.
- **Prompt cache**: the cache hit rate for the last request and for the whole
  session (main session and agents), the read/write/new split, how long the
  session has been idle, and what the cache saved: reads priced against the
  base input rate, less the premium paid on cache writes.
- **Cache tax**: whether the one-hour cache is warm (and for how long) or
  cold, what re-writing it would cost against a warm turn, the keepwarm
  window and next ping, the last ping's cost, the guard mode, and the cold
  writes paid this session.
- **Tools**: total calls and failures, the most-used tools, and any tool
  running now with its elapsed time.
- **Agents**: each subagent's status, type and task, elapsed time, tool calls,
  tokens and the tool it's using now.
- **Controls**: switches for keepwarm, the cold-send guard, alerts and the
  done notification (see below).

## Install

At the Claude Code prompt:

    /plugin marketplace add miskopisko/claude-toolkit
    /plugin install session-stats@miskopisko

From a shell:

    claude plugin install session-stats --marketplace miskopisko/claude-toolkit

## Use

The pane opens by itself when the terminal is at least 144 columns wide.

- `/session-stats` opens it at any width. It docks on the right in fullscreen
  mode from 110 columns, and sits above the prompt otherwise.
- `/session-stats close` hides it.

### Keepwarm and the cold-send guard

    /keepwarm               keep the cache warm for six hours
    /keepwarm 90m           keep it warm for a window of your own (also 2h30m, 6h)
    /keepwarm always        arm a six-hour window at every session start
    /keepwarm 6h every 2m   ping every two minutes (a testing knob, 1m to 59m)
    /keepwarm status        the window, next ping and last ping
    /keepwarm off           stop, and turn always off
    /cache-tax              the cache card: state, cold cost, keepwarm, tally
    /cache-tax guard warn   show the price of a cold send and send it
    /cache-tax guard refuse drop a cold send once; the resend goes through (default)

While keepwarm is on, after 50 idle minutes it sends one small, tool-less
request over the conversation so the cache is read rather than re-written.
**Each ping costs tokens.** Keepwarm stops if a ping finds the cache already
gone. A cold write that gets paid arms keepwarm for three hours.

The guard steps in only when the context is at least 50,000 tokens and the
one-hour clock says the cache is cold. The cold cost is an upper bound.

Prices are the Claude API list prices on
[Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing),
read 2026-10-21, including Haiku 5.5's higher rates for a prompt over 100,000
tokens. Cloud-provider and US-only (`inference_geo`) pricing differ. Older
Sonnet and Haiku models the page no longer lists are priced as Sonnet 4 and
Haiku 4.5.

Keepwarm assumes a one-hour cache. Subscription usage defaults to one hour;
for API-key or cloud-provider sessions, set `promptCacheTtl` to `"1h"`.

### Alerts

The plugin writes a dim line in the transcript, once each, when:

- the context window passes 80% (again only after it drops under 70%);
- a usage limit passes 90%;
- at the current pace, a usage limit will run out within the hour, before it resets;
- a single turn costs $5 or more.

They appear whether or not the pane is open. `/session-stats alerts off`
turns them off in every session; `/session-stats alerts on` turns them back on.

### Done notification

When a turn runs two minutes or longer, a desktop notification says so when it
finishes, with the first line of the answer, so you can step away during long
runs. It goes through your own notification channel (`preferredNotifChannel`);
a turn that was interrupted or ended in an API error sends none.
`/session-stats notify off` turns it off in every session;
`/session-stats notify on` turns it back on.

### Controls

The pane's Controls section holds four switches. Click one, or focus the pane
(ctrl+x tab) and press its key:

    k  keepwarm   on arms a six-hour window, as /keepwarm; off as /keepwarm off
                  (shown once cache-tax has started, just after the session does)
    g  guard      refuse a cold send once, or only warn
    a  alerts     the transcript alerts above
    n  notify     the done notification

Each is remembered across sessions, the same as its slash command.

## Notes

- Token, tool, turn and savings counts start when the plugin loads and run on
  through `/clear`. A `/clear` starts the prompt cache rows (last request, idle
  time) and the compaction count over, along with cache-tax's clock and tally.
  Cost, context and usage limits come from Claude Code itself, so those are
  always complete.
- Cache savings are priced at list prices, with cache writes at the
  one-hour rate (as cache-tax assumes). On a five-minute cache the write
  premium is a quarter of that, so the net saving is understated.
- The pane's clock ticks once a second from the pane's first draw until it is
  closed (`/session-stats close` or its close mark), even while another pane's
  tab is in front. A pane never drawn costs nothing. The agent list is
  refreshed every 2 seconds while it ticks.
- Where an organization manages Claude Code, plugins you install don't receive
  the resume and compaction events, so cache-tax can't use a resumed session's
  timing or reset itself after a compaction there.

## Develop

The hooks module is `hooks/register.tsx`, with number formatting in
`hooks/format.ts`, burn rate, forecasts and cache savings in `hooks/pace.ts`,
alert thresholds in `hooks/alerts.ts`, cache-tax in `hooks/cache-tax.ts` and
the pane's state types in `types/index.d.ts`.

    claude plugin validate .
    claude plugin test .
    tsc -p .

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which is not in
git: Claude Code writes `.claude-plugin/types/` (the plugin API's typings and
that tsconfig) each time it loads the plugin from a folder you own. On a fresh
clone, start one session with it loaded before running `tsc`:

    claude --plugin-dir .

## License

cache-tax is Copyright (c) 2026 Karan Bansal, used under the MIT License: see
[LICENSE-cache-tax](LICENSE-cache-tax). `hooks/cache-tax.ts` and
`tests/cache-tax.test.ts` are ported from it.
