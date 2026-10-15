# session-stats

A Claude Code side pane with live stats for the current session. In fullscreen
mode it docks on the right of the transcript.

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
  session, the read/write/new split, how long the session has been idle, and
  time left on a 5-minute and a 1-hour cache.
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

## Notes

- Token and tool counts start when the plugin loads. Cost, context and usage
  limits come from Claude Code itself, so those are always complete.
- A plugin can't see which cache lifetime a request used, so the pane shows
  both the 5-minute and 1-hour countdowns.
- The agent list is refreshed every 2 seconds.

## Develop

The hooks module is `hooks/register.tsx`, with number formatting in
`hooks/format.ts` and the pane's state types in `types/index.d.ts`.

    claude plugin validate .
    claude plugin test .
