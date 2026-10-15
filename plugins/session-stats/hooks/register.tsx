import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit, Timer } from 'claude-code'

import type { AgentRow, CacheTaxView, Snapshot, ToolStats, Tokens, TurnInfo } from '../types'
import {
  addUsage,
  bar,
  duration,
  emptyUsage,
  hitRate,
  levelColor,
  limitName,
  tokens as tok,
  usd,
} from './format'
import {
  cacheTaxSessionCompact,
  cacheTaxSessionStart,
  cacheTaxTurnComplete,
  cacheTaxTurnStep,
  freshState,
  hookCacheTax,
} from './cache-tax'

const PANE = 'session-stats'
const TITLE = 'Session stats'
const WIDTH = 46
const ACTIVE = new Set(['pending', 'running', 'waiting'])

const snap = atom({ plugin: 'session-stats', key: 'snap' } as const, {
  startedAt: null,
  model: null,
  effort: null,
  contextTokens: null,
  contextWindow: null,
  contextPercent: null,
  rateLimits: [],
  costUsd: null,
  version: null,
} satisfies Snapshot)
const tokens = atom({ plugin: 'session-stats', key: 'tokens' } as const, {
  main: emptyUsage(),
  agents: emptyUsage(),
  last: null,
} satisfies Tokens)
const turn = atom({ plugin: 'session-stats', key: 'turn' } as const, {
  count: 0,
  runningSince: null,
  lastMs: null,
  steps: 0,
  compactions: 0,
} satisfies TurnInfo)
const tools = atom({ plugin: 'session-stats', key: 'tools' } as const, {
  counts: {},
  errors: 0,
  running: [],
} satisfies ToolStats)
const agents = atom({ plugin: 'session-stats', key: 'agents' } as const, [] as AgentRow[])
const now = atom({ plugin: 'session-stats', key: 'now' } as const, 0)
// Written by hooks/cache-tax.ts, which declares the same reference.
const cacheTaxView = atom({ plugin: 'session-stats', key: 'cacheTax' } as const, null as CacheTaxView | null)

type Measured = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

function measured($: EngineInterface, m: Measured) {
  return update($, snap, s => ({
    ...s,
    contextTokens: m.context.tokens ?? s.contextTokens,
    contextWindow: m.context.window,
    contextPercent: m.context.percent ?? s.contextPercent,
    rateLimits: m.rateLimits.length > 0 ? m.rateLimits.map(r => ({ ...r })) : s.rateLimits,
    costUsd: m.cost?.usd ?? s.costUsd,
  }))
}

async function pollAgents($: EngineInterface) {
  const at = await $.clock.now()
  const list = await $.agent.list()
  await update($, agents, rows => {
    const byId = new Map(rows.map(r => [r.id, r]))
    for (const a of list) {
      const was = byId.get(a.id)
      byId.set(a.id, {
        id: a.id,
        description: a.description,
        type: a.type,
        status: a.status,
        firstSeen: was?.firstSeen ?? at,
        lastSeen: ACTIVE.has(a.status) || was === undefined ? at : was.lastSeen,
        tokens: was?.tokens ?? 0,
        tools: was?.tools ?? 0,
        lastTool: was?.lastTool ?? null,
      })
    }
    // An agent the engine dropped from its list while we last saw it active has finished.
    const listed = new Set(list.map(a => a.id))
    for (const [id, r] of byId) {
      if (!listed.has(id) && ACTIVE.has(r.status)) byId.set(id, { ...r, status: 'completed' })
    }
    return [...byId.values()].slice(-30)
  })
}

// The pane's clock: one tick a second, run only while the pane is drawn, so a
// hidden pane costs nothing. The agent list is polled on every other tick.
let ticker: Timer | null = null

function startTicker($: EngineInterface) {
  if (ticker !== null) return
  let ticks = 0
  ticker = $.clock.every(1000, async () => {
    ticks += 1
    const tickAt = await $.clock.now()
    await update($, now, () => tickAt)
    if (ticks % 2 === 0) await pollAgents($)
  })
}

function stopTicker() {
  ticker?.cancel()
  ticker = null
}

function touchAgent(id: string, at: number, change: (r: AgentRow) => AgentRow) {
  return (rows: AgentRow[]) => {
    const row = rows.find(r => r.id === id) ?? {
      id,
      description: '',
      type: 'agent',
      status: 'running',
      firstSeen: at,
      lastSeen: at,
      tokens: 0,
      tools: 0,
      lastTool: null,
    }
    return [...rows.filter(r => r.id !== id), change(row)].slice(-30)
  }
}

export const register: Register = on => {
  const cacheTax = freshState()
  hookCacheTax(on, cacheTax)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-stats',
      description: 'Toggle the session stats pane (/session-stats close hides it)',
    })
    const started = await $.clock.now()
    const [usage, version] = await Promise.all([$.session.usage(), $.session.version()])
    await update($, snap, s => ({ ...s, startedAt: usage.startedAt ?? started, version: version.version }))
    await measured($, usage)
    await update($, now, () => started)

    // Unasked, the pane is placed only on a wide terminal; its first draw starts the clock.
    void $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })

    const result = await next(e)
    await cacheTaxSessionStart($, cacheTax)
    return result
  })

  on('command.run', { command: 'session-stats' }, async ($, e) => {
    if (e.args.trim() === 'close') {
      await $.ui.close({ id: PANE })
      stopTicker()
      return { text: 'Session stats pane closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })
    return {
      text: opened.isPlaced
        ? 'Session stats pane opened. In fullscreen mode it docks on the right.'
        : `Session stats pane is waiting to be placed: ${opened.reason}`,
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    stopTicker()
    return closed
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await measured($, e)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, turn, t => ({ ...t, count: t.count + 1, runningSince: at, steps: 0 }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await cacheTaxTurnComplete($, cacheTax, e)
    if (e.agentId === undefined) {
      await update($, turn, t => ({ ...t, runningSince: null, lastMs: e.durationMs }))
      await measured($, await $.session.usage())
    } else {
      const at = await $.clock.now()
      await update($, agents, touchAgent(e.agentId, at, r => ({ ...r, lastSeen: at })))
    }
    return done
  })

  on('turn.step', async function* ($, e, next) {
    await cacheTaxTurnStep($, cacheTax, e)
    if (e.agentId === undefined) {
      await update($, turn, t => ({ ...t, steps: e.index + 1 }))
      await update($, snap, s => ({
        ...s,
        model: e.model,
        effort: e.effort === undefined ? null : String(e.effort),
      }))
    }

    const result = yield* next(e)

    const u = result.usage
    if (u !== null) {
      const at = await $.clock.now()
      if (e.agentId === undefined) {
        await update($, tokens, t => ({
          ...t,
          main: addUsage(t.main, u),
          last: {
            model: u.model,
            at,
            input: u.input_tokens,
            output: u.output_tokens,
            cacheRead: u.cache_read_input_tokens,
            cacheWrite: u.cache_creation_input_tokens,
          },
        }))
      } else {
        const spent = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        await update($, tokens, t => ({ ...t, agents: addUsage(t.agents, u) }))
        await update($, agents, touchAgent(e.agentId, at, r => ({ ...r, tokens: r.tokens + spent, lastSeen: at })))
      }
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const id = e.tool_use_id
    const name = String(e.tool)
    await update($, tools, t => ({
      ...t,
      running: [...t.running.filter(r => r.id !== id), { id, tool: name, since: at, agentId: e.agentId }].slice(-50),
    }))
    if (e.agentId !== undefined) {
      await update($, agents, touchAgent(e.agentId, at, r => ({ ...r, tools: r.tools + 1, lastTool: name, lastSeen: at })))
    }

    let isError = true
    try {
      const ran = await next(e)
      isError = ran.isError === true || typeof ran.deny === 'string'
      return ran
    } finally {
      await update($, tools, t => ({
        counts: { ...t.counts, [name]: (t.counts[name] ?? 0) + 1 },
        errors: t.errors + (isError ? 1 : 0),
        running: t.running.filter(r => r.id !== id),
      }))
    }
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    // A precompute installs nothing: the conversation is not compacted until a later dispatch uses it.
    if (e.trigger !== 'precompute') {
      await update($, turn, t => ({ ...t, compactions: t.compactions + 1 }))
      await cacheTaxSessionCompact($, cacheTax, e)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    startTicker($)
    const { Box, Text } = $.ui.resolve(e)
    const [s, tk, t, tl, ag, tickAt, ct] = await Promise.all([
      read($, snap),
      read($, tokens),
      read($, turn),
      read($, tools),
      read($, agents),
      read($, now),
      read($, cacheTaxView),
    ])
    // The tick redraws the pane each second; the live clock keeps a pane drawn again after a while hidden from showing an old time.
    const at = Math.max(tickAt, await $.clock.now())
    const cols = Math.max(24, e.props.bodyColumns)
    const barWidth = Math.max(6, Math.min(20, cols - 26))

    const head = (children: string) => (
      <Box marginTop={1}>
        <Text bold color="claude">
          {children}
        </Text>
      </Box>
    )
    const row = (label: string, value: string, color?: string) => (
      <Box>
        <Box width={13} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text color={color} wrap="truncate-end">
          {value}
        </Text>
      </Box>
    )

    // Model and context
    const model = tk.last?.model ?? s.model
    const ctxPct = s.contextPercent

    // Cache
    const last = tk.last
    const lastHit = last === null ? null : hitRate(last)
    const allHit = hitRate(tk.main)
    const age = last === null ? null : at - last.at
    // Warm or cold by the clock now, not as of cache-tax's last change: the cache lapses with nothing happening.
    const cacheState = ct === null || ct.expiresAt === null ? 'unknown' : at >= ct.expiresAt ? 'cold' : 'warm'

    // Tools
    const totalCalls = Object.values(tl.counts).reduce((a, b) => a + b, 0)
    const top = Object.entries(tl.counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, c]) => `${n} ${c}`)
      .join(' · ')

    // Agents
    const active = ag.filter(a => ACTIVE.has(a.status))
    const finished = ag.filter(a => !ACTIVE.has(a.status))
    const shownAgents = [...active, ...finished.slice(-Math.max(0, 6 - active.length))]

    const both = {
      input: tk.main.input + tk.agents.input,
      output: tk.main.output + tk.agents.output,
      cacheRead: tk.main.cacheRead + tk.agents.cacheRead,
      cacheWrite: tk.main.cacheWrite + tk.agents.cacheWrite,
    }

    return (
      <Box flexDirection="column" width={cols}>
        <Text bold>Session</Text>
        {row("Model", model ?? 'not seen yet')}
        {s.effort !== null && row("Effort", s.effort)}
        {row("Status", t.runningSince === null ? 'idle' : `working ${duration(at - t.runningSince)} · step ${t.steps}`, t.runningSince === null ? undefined : 'warning')}
        {row("Uptime", s.startedAt === null ? '—' : duration(at - s.startedAt))}
        {row("Turns", `${t.count}${t.lastMs === null ? '' : ` · last ${duration(t.lastMs)}`}${t.compactions > 0 ? ` · ${t.compactions} compacted` : ''}`)}
        {s.costUsd !== null && row("Cost", usd(s.costUsd))}

        {head('Context')}
        {ctxPct === null ? (
          <Text dimColor>No reading until the next response.</Text>
        ) : (
          <>
            <Box>
              <Text color={levelColor(ctxPct)}>{bar(ctxPct, barWidth)}</Text>
              <Text> {ctxPct}%</Text>
            </Box>
            <Text dimColor>
              {tok(s.contextTokens ?? 0)} of {tok(s.contextWindow ?? 0)} · {tok(Math.max(0, (s.contextWindow ?? 0) - (s.contextTokens ?? 0)))} free
            </Text>
          </>
        )}

        {head('Usage limits')}
        {s.rateLimits.length === 0 ? (
          <Text dimColor>No reading (API key, or no response yet).</Text>
        ) : (
          s.rateLimits.map(r => {
            const left = Math.max(0, 100 - r.percentUsed)
            const resets = r.resetsAt === undefined ? null : Date.parse(r.resetsAt) - at
            return (
              <Box flexDirection="column" key={r.kind}>
                <Box>
                  <Box width={13} flexShrink={0}>
                    <Text dimColor>{limitName(r.kind)}</Text>
                  </Box>
                  <Text color={levelColor(r.percentUsed)}>{bar(r.percentUsed, barWidth)}</Text>
                </Box>
                <Text dimColor>
                  {'             '}
                  {left.toFixed(left % 1 === 0 ? 0 : 1)}% left
                  {resets === null || Number.isNaN(resets) ? '' : ` · resets in ${duration(resets)}`}
                </Text>
              </Box>
            )
          })
        )}

        {head('Tokens')}
        {row("Input", `${tok(both.input)} new · ${tok(both.cacheRead)} cached`)}
        {row("Cache write", tok(both.cacheWrite))}
        {row("Output", tok(both.output))}
        {row("Requests", `${tk.main.requests} main · ${tk.agents.requests} agents`)}
        {tk.agents.requests > 0 &&
          row("Agents' share", `${tok(tk.agents.input + tk.agents.cacheRead + tk.agents.cacheWrite + tk.agents.output)} tokens`)}

        {head('Prompt cache')}
        {last === null ? (
          <Text dimColor>No request yet.</Text>
        ) : (
          <>
            {row("Last request", `${lastHit ?? 0}% hit`, lastHit !== null && lastHit >= 70 ? 'success' : 'warning')}
            <Text dimColor>
              {'             '}
              read {tok(last.cacheRead)} · write {tok(last.cacheWrite)} · new {tok(last.input)}
            </Text>
            {row("Session hit", allHit === null ? '—' : `${allHit}%`)}
            {row("Idle for", age === null ? '—' : duration(age))}
          </>
        )}

        {head('Cache tax')}
        {ct === null ? (
          <Text dimColor>Starting…</Text>
        ) : (
          <>
            {row(
              'Cache',
              cacheState === 'unknown'
                ? 'unknown until the next turn'
                : cacheState === 'cold'
                  ? `cold for ${duration(at - (ct.expiresAt ?? at))}`
                  : `warm, ${duration((ct.expiresAt ?? at) - at)} left`,
              cacheState === 'warm' ? 'success' : cacheState === 'cold' ? 'error' : undefined,
            )}
            {ct.ctx > 0 &&
              row(
                'Cold cost',
                `${ct.coldUsd === null ? 'n/a' : usd(ct.coldUsd)} to re-write${ct.warmUsd === null ? '' : ` · warm ${usd(ct.warmUsd)}`}`,
              )}
            {row(
              'Keepwarm',
              ct.stopped !== null
                ? `stopped: ${ct.stopped}`
                : ct.deadline === null
                  ? ct.always ? 'off until next session (always)' : 'off · /keepwarm to arm'
                  : `on, ${duration(ct.deadline - at)} left${ct.always ? ' (always)' : ''}`,
              ct.stopped !== null ? 'warning' : ct.deadline === null ? undefined : 'success',
            )}
            {ct.deadline !== null &&
              row(
                'Next ping',
                ct.nextPingAt !== null && cacheState === 'warm' ? `in ${duration(Math.max(0, ct.nextPingAt - at))}` : 'after the next turn',
              )}
            {ct.lastPing !== null &&
              row(
                'Last ping',
                `read ${tok(ct.lastPing.read)} · ${ct.lastPing.usd === null ? 'n/a' : usd(ct.lastPing.usd)} · ${duration(at - ct.lastPing.at)} ago`,
              )}
            {row('Guard', ct.guard === 'refuse' ? 'refuse a cold send once' : 'warn only')}
            {row(
              'Cold writes',
              `${ct.coldWrites} paid${ct.coldWrites > 0 ? `, ${usd(ct.paidUsd)}` : ''}`,
              ct.coldWrites > 0 ? 'warning' : undefined,
            )}
          </>
        )}

        {head('Tools')}
        {row("Calls", `${totalCalls}${tl.errors > 0 ? ` · ${tl.errors} failed` : ''}`)}
        {top !== '' && <Text dimColor wrap="wrap">{top}</Text>}
        {tl.running.map(r => (
          <Text color="warning" wrap="truncate-end" key={r.id}>
            ▸ {r.tool} {duration(at - r.since)}
            {r.agentId === undefined ? '' : ' (agent)'}
          </Text>
        ))}

        {head('Agents')}
        {shownAgents.length === 0 ? (
          <Text dimColor>None this session.</Text>
        ) : (
          <>
            <Text dimColor>
              {active.length} running · {finished.length} finished
            </Text>
            {shownAgents.map(a => {
              const isActive = ACTIVE.has(a.status)
              const color = isActive ? 'warning' : a.status === 'completed' || a.status === 'idle' ? 'success' : 'error'
              return (
                <Box flexDirection="column" key={a.id}>
                  <Text wrap="truncate-end">
                    <Text color={color}>{isActive ? '●' : a.status === 'completed' || a.status === 'idle' ? '✓' : '✗'}</Text>{' '}
                    <Text bold>{a.type}</Text> {a.description}
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {a.status} · {duration((isActive ? at : a.lastSeen) - a.firstSeen)} · {a.tools} tools · {tok(a.tokens)} tok
                    {isActive && a.lastTool !== null ? ` · ${a.lastTool}` : ''}
                  </Text>
                </Box>
              )
            })}
          </>
        )}
        {s.version !== null && (
          <Box marginTop={1}>
            <Text dimColor>Claude Code {s.version}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
