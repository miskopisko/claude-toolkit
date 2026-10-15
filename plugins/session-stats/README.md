# session-stats

A Claude Code side pane with live stats for the current session. In fullscreen
mode it docks on the right of the transcript.

It also includes [cache-tax](https://github.com/karanb192/cache-tax): it keeps
the one-hour prompt cache warm during breaks, and stops a send that would
re-write a cold cache once, showing what it would cost. If you have cache-tax
installed separately, uninstall it so the guard doesn't run twice.

## What it shows

- **Session**: the model in use and its effort level, whether Claude is idle or
  working (with elapsed time and step), uptime, turns and the last turn's
  length, compactions, and cost in dollars.
- **Context**: how full the context window is, as a bar, with tokens used,
  window size and free space.
- **Usage limits**: the 5-hour and 7-day windows, with percent left and time
  until each resets (subscription accounts only).
- **Tokens**: new input, cached input, cache writes, output and request counts,
  for the main session and for agents.
- **Prompt cache**: the cache hit rate for the last request and for the whole
  session, the read/write/new split, and how long the session has been idle.
- **Cache tax**: whether the one-hour cache is warm (and for how long) or
  cold, what re-writing it would cost against a warm turn, the keepwarm
  window and next ping, the last ping's cost, the guard mode, and the cold
  writes paid this session.
- **Tools**: total calls and failures, the most-used tools, and any tool
  running now with its elapsed time.
- **Agents**: each subagent's status, type and task, elapsed time, tool calls,
  tokens and the tool it's using now.

## Install

At the Claude Code prompt:

    /plugin install session-stats --marketplace miskopisko/claude-session-stats

From a shell:

    claude plugin install session-stats --marketplace miskopisko/claude-session-stats

## Use

The pane opens by itself when the terminal is at least 144 columns wide.

- `/session-stats` opens it at any width. It docks on the right in fullscreen
  mode from 110 columns, and sits above the prompt otherwise.
- `/session-stats close` hides it.

### Keepwarm and the cold-send guard

    /keepwarm               keep the cache warm for six hours
    /keepwarm 90m           keep it warm for a window of your own (also 2h30m, 6h)
    /keepwarm always        arm a six-hour window at every session start
    /keepwarm 6h every 2m   ping every two minutes (a testing knob, floor 1m)
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
one-hour clock says the cache is cold. Prices are list prices from September
2026, and the cold cost is an upper bound.

Keepwarm assumes a one-hour cache. Subscription usage defaults to one hour;
for API-key or cloud-provider sessions, set `promptCacheTtl` to `"1h"`.

## Notes

- Token and tool counts start when the plugin loads. Cost, context and usage
  limits come from Claude Code itself, so those are always complete.
- The pane's clock ticks once a second, only while the pane is on screen. The
  agent list is refreshed every 2 seconds while it ticks.
- Where an organization manages Claude Code, plugins you install don't receive
  the resume and compaction events, so cache-tax can't use a resumed session's
  timing or reset itself after a compaction there.

## Develop

The hooks module is `hooks/register.tsx`, with number formatting in
`hooks/format.ts`, cache-tax in `hooks/cache-tax.ts` and the pane's state
types in `types/index.d.ts`.

    claude plugin validate .
    claude plugin test .

## License

cache-tax is Copyright (c) 2026 Karan Bansal, used under the MIT License: see
[LICENSE-cache-tax](LICENSE-cache-tax). `hooks/cache-tax.ts` and
`tests/cache-tax.test.ts` are ported from it.
