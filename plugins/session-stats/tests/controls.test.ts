import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandRunInput, On, TurnCompleteInput } from 'claude-code'

const MIN = 60 * 1000
const START = Date.UTC(2026, 9, 15, 9)

const PANE = {
  title: 'Session stats',
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 120 },
  view: {},
} as const

const run = (args: string): CommandRunInput => ({
  command: 'session-stats', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const turn = (durationMs: number, over: { answer?: string; isAborted?: boolean; reason?: 'answer' | 'error' } = {}): TurnCompleteInput => ({
  answer: over.answer ?? 'All tests pass.\nDetails follow.', durationMs, isAborted: over.isAborted ?? false, turnId: 't1', reason: over.reason ?? 'answer',
})

// The engine beneath the plugin, enough for session start, the pane and a turn's end.
function world(on: On, entries: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  const notified: Array<{ text: string; title?: string }> = []
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($, e) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.version', () => ({ value: { version: 'test' } }))
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 200_000 }, rateLimits: [] } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('turn.complete', ($, e) => ({ text: e.reason === 'refusal' ? '' : e.answer }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('ui.notify', ($, e) => { notified.push({ text: e.text, title: e.title }); return { value: { isSent: true, channel: 'terminal_bell' } } })
  return { store, notified }
}

const start = ($: Engine) => $.session.start({ surface: null, isInteractive: true, cwd: '/work' })

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`${surface}: controls`, () => {
    const mount = ($: Engine) =>
      $.ui.mount({ plugin: 'session-stats', surface, component: 'Pane', requestId: 'session-stats', props: PANE })

    test('keepwarm and guard buttons drive cache-tax', async ($, on) => {
      mock.clock(on, { now: START })
      const { store } = world(on)
      await start($)
      const ui = await mount($)
      expect(await ui.find({ text: /keepwarm off/ })).toBeDefined()
      await ui.press({ key: 'keepwarm' })
      expect(await ui.find({ text: /keepwarm on/ })).toBeDefined()
      expect(await ui.find({ text: /^on, 6h00m left$/ })).toBeDefined()
      expect(store.get('deadline:S1')).toBe(START + 6 * 60 * MIN)
      await ui.press({ key: 'keepwarm' })
      expect(await ui.find({ text: /keepwarm off/ })).toBeDefined()
      expect(store.has('deadline:S1')).toBe(false)

      await ui.press({ key: 'guard' })
      expect(await ui.find({ text: /guard warn/ })).toBeDefined()
      expect(store.get('guard')).toBe('warn')
      await ui.press({ key: 'guard' })
      expect(await ui.find({ text: /guard refuse/ })).toBeDefined()
    })

    test('alerts and notify buttons flip and are remembered', async ($, on) => {
      mock.clock(on, { now: START })
      const { store } = world(on)
      await start($)
      const ui = await mount($)
      await ui.press({ key: 'alerts' })
      await ui.press({ key: 'notify' })
      expect(await ui.find({ text: /alerts off/ })).toBeDefined()
      expect(await ui.find({ text: /notify off/ })).toBeDefined()
      expect(store.get('alerts')).toBe(false)
      expect(store.get('notify')).toBe(false)
      await ui.press({ key: 'notify' })
      expect(await ui.find({ text: /notify on/ })).toBeDefined()
      expect(store.has('notify')).toBe(false)
    })
  })
}

describe('/session-stats', () => {
  test('an unknown word answers with the usage instead of opening the pane', async ($, on) => {
    mock.clock(on, { now: START })
    world(on)
    await start($)
    expect((await $.command.run(run('alert off'))).text).toBe('Usage: /session-stats [close | alerts on|off | notify on|off]')
    expect((await $.command.run(run(''))).text).toMatch(/^Session stats pane is waiting to be placed/)
  })
})

describe('done notification', () => {
  test('a long turn notifies with its first line; a short, interrupted or failed one does not', async ($, on) => {
    mock.clock(on, { now: START })
    const { notified } = world(on)
    await start($)
    await $.turn.complete(turn(90 * 1000))
    await $.turn.complete(turn(5 * MIN, { isAborted: true }))
    await $.turn.complete(turn(5 * MIN, { reason: 'error' }))
    await $.turn.complete(turn(3 * MIN + 12_000))
    expect(notified).toEqual([{ text: 'Done after 3m12s: All tests pass.', title: 'Claude Code' }])
  })

  test('/session-stats notify off is remembered by the next session', async ($, on) => {
    mock.clock(on, { now: START })
    const { notified } = world(on, { notify: false })
    await start($)
    await $.turn.complete(turn(10 * MIN))
    expect(notified).toEqual([])
    await $.command.run(run('notify on'))
    await $.turn.complete(turn(10 * MIN))
    expect(notified.length).toBe(1)
  })
})
