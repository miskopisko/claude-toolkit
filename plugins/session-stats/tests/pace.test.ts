import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandRunInput, On, SessionMeasureInput, SessionRateLimit, TurnUsage } from 'claude-code'

import { addSample, cacheSavings, forecast, perHour } from '../hooks/pace'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const START = Date.UTC(2026, 9, 15, 9)
const RESETS = new Date(START + 3 * HOUR).toISOString()

const PANE = {
  title: 'Session stats',
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 120 },
  view: {},
} as const

const fiveHour = (percentUsed: number): SessionRateLimit => ({ kind: 'five_hour', percentUsed, resetsAt: RESETS })

const measure = (over: { percent?: number; usd?: number; limits?: SessionRateLimit[] }): SessionMeasureInput => ({
  context: { window: 200_000, tokens: over.percent === undefined ? undefined : over.percent * 2000, percent: over.percent },
  rateLimits: over.limits ?? [],
  cost: over.usd === undefined ? undefined : { usd: over.usd },
  changed: ['context'],
})

const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-fable-5-1', ...over,
})

const run = (args: string): CommandRunInput => ({
  command: 'session-stats', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

// The engine beneath the plugin: it answers what session-stats and its cache-tax half call,
// and collects what they log.
function world(on: On, live: { usd?: number } = {}) {
  const logs: string[] = []
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($, e) => { store.delete(e.key); return { value: undefined } })
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000 }, rateLimits: [], cost: live.usd === undefined ? undefined : { usd: live.usd } },
  }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.log', ($, e) => { logs.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  return { logs, store }
}

describe('pace', () => {
  test('a pace is measured over the last hour, idle time included', () => {
    let s = addSample([], 0, 0)
    expect(perHour(s, 4 * MIN)).toBe(null)
    s = addSample(s, 30 * MIN, 10)
    expect(perHour(s, 30 * MIN)).toBe(20)
    // Thirty idle minutes halve it.
    expect(perHour(s, HOUR)).toBe(10)
  })

  test('a flat run keeps its ends, an old reading becomes the baseline, and a drop starts over', () => {
    let s = addSample([], 0, 5)
    s = addSample(s, MIN, 5)
    s = addSample(s, 2 * MIN, 5)
    expect(s).toEqual([{ at: 0, value: 5 }, { at: 2 * MIN, value: 5 }])
    s = addSample(s, 2 * HOUR, 9)
    expect(s).toEqual([{ at: 2 * MIN, value: 5 }, { at: 2 * HOUR, value: 9 }])
    expect(addSample(s, 3 * HOUR, 1)).toEqual([{ at: 3 * HOUR, value: 1 }])
  })

  test('a forecast runs out before the reset, or says where it lands', () => {
    expect(forecast(50, 25, 3 * HOUR)).toEqual({ kind: 'full', inMs: 2 * HOUR })
    expect(forecast(50, 10, 3 * HOUR)).toEqual({ kind: 'at-reset', percent: 80 })
    expect(forecast(50, 0, 3 * HOUR)).toEqual({ kind: 'at-reset', percent: 50 })
    expect(forecast(50, null, 3 * HOUR)).toBe(null)
    expect(forecast(100, null, null)).toEqual({ kind: 'full', inMs: 0 })
  })

  test('cache savings: reads against the base rate, writes at the 1-hour premium', () => {
    // Fable 5.1: read $0.25, 1h write $20, so base input $10.
    const saved = cacheSavings({ cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 100_000 }, [0.25, 20, 50])
    expect(Math.round(saved.readsUsd * 100) / 100).toBe(9.75)
    expect(Math.round(saved.premiumUsd * 100) / 100).toBe(1)
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`${surface}: pane`, () => {
    const mount = ($: Engine) =>
      $.ui.mount({ plugin: 'session-stats', surface, component: 'Pane', requestId: 'session-stats', props: PANE })

    test('shows the burn rate, and each limit as a bar and its percent used', async ($, on) => {
      const clock = mock.clock(on, { now: START })
      world(on)
      await $.session.measure(measure({ usd: 0, limits: [fiveHour(10)] }))
      await clock.advance(30 * MIN)
      await $.session.measure(measure({ usd: 2, limits: [fiveHour(20.4)] }))
      const ui = await mount($)
      expect(await ui.find({ text: /^\$4\.00 an hour$/ })).toBeDefined()
      expect(await ui.find({ text: /^ 20%$/ })).toBeDefined()
      expect(await ui.find({ text: /% left|at this pace/ })).toBeUndefined()
    })

    test('shows what the prompt cache saved, net of its writes', async ($, on) => {
      mock.clock(on, { now: START })
      world(on)
      on('turn.step', async function* ($, e) {
        return {
          turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
          usage: usage({ cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 100_000 }),
        }
      })
      const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-fable-5-1', messageCount: 1 })
      for await (const _ of step);
      await step.result
      const ui = await mount($)
      expect(await ui.find({ text: /^\$8\.75 net$/ })).toBeDefined()
      expect(await ui.find({ text: /\$9\.75 on reads · \$1\.00 on writes/ })).toBeDefined()
    })
  })
}

describe('alerts', () => {
  test('context warns once at 80%, and again only after it drops under 70%', async ($, on) => {
    mock.clock(on, { now: START })
    const { logs } = world(on)
    await $.session.measure(measure({ percent: 75 }))
    await $.session.measure(measure({ percent: 82 }))
    await $.session.measure(measure({ percent: 85 }))
    expect(logs).toEqual(['session-stats: context is 82% full (164k of 200k). Compaction is coming; /compact at a natural break keeps the timing yours.'])
    await $.session.measure(measure({ percent: 40 }))
    await $.session.measure(measure({ percent: 81 }))
    expect(logs.length).toBe(2)
  })

  test('a limit warns once at 90%', async ($, on) => {
    mock.clock(on, { now: START })
    const { logs } = world(on)
    await $.session.measure(measure({ limits: [fiveHour(91)] }))
    await $.session.measure(measure({ limits: [fiveHour(95)] }))
    expect(logs).toEqual(['session-stats: the 5-hour limit is 91% used, resets in 3h00m.'])
  })

  test('a forecast that runs out within the hour warns once', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const { logs } = world(on)
    await $.session.measure(measure({ limits: [fiveHour(10)] }))
    await clock.advance(30 * MIN)
    await $.session.measure(measure({ limits: [fiveHour(50)] }))
    await $.session.measure(measure({ limits: [fiveHour(51)] }))
    // 80 points an hour, 50 left: out in 37m30s, 1h52m before the reset at 2h30m.
    expect(logs).toEqual(['session-stats: at this pace the 5-hour limit runs out in 37m30s, 1h52m before it resets.'])
  })

  test('a costly turn warns; a cheap one does not', async ($, on) => {
    mock.clock(on, { now: START })
    const live: { usd?: number } = { usd: 1 }
    const { logs } = world(on, live)
    const turn = { answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer' as const, usage: usage() }
    await $.turn.start({ text: 'go', turnId: 't1' })
    live.usd = 2
    await $.turn.complete({ ...turn, turnId: 't1' })
    await $.turn.start({ text: 'go', turnId: 't2' })
    live.usd = 8.5
    await $.turn.complete({ ...turn, turnId: 't2' })
    expect(logs).toEqual(['session-stats: that turn cost $6.50 (session $8.50).'])
  })

  test('/session-stats alerts off silences them and is remembered', async ($, on) => {
    mock.clock(on, { now: START })
    const { logs, store } = world(on)
    await $.command.run(run('alerts off'))
    expect(store.get('alerts')).toBe(false)
    await $.session.measure(measure({ percent: 90 }))
    expect(logs).toEqual([])
    await $.command.run(run('alerts on'))
    expect(store.has('alerts')).toBe(false)
    await $.session.measure(measure({ percent: 91 }))
    expect(logs.length).toBe(1)
  })
})
