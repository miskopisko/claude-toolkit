import { describe, expect, mock, test } from 'claude-code/testing'

import { bar, duration, hitRate, tokens, usd } from '../hooks/format'

const PANE = {
  title: 'Session stats',
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

describe('format', () => {
  test('tokens, durations, bars and hit rate read as the pane shows them', () => {
    expect(tokens(950)).toBe('950')
    expect(tokens(12_345)).toBe('12.3k')
    expect(tokens(120_000)).toBe('120k')
    expect(tokens(1_250_000)).toBe('1.25M')
    expect(duration(192_000)).toBe('3m12s')
    expect(duration(8_040_000)).toBe('2h14m')
    expect(bar(50, 10)).toBe('█████░░░░░')
    expect(hitRate({ input: 10, cacheRead: 90, cacheWrite: 0 })).toBe(90)
    expect(hitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBe(null)
    expect(usd(75.8)).toBe('$75.80')
    expect(usd(2.281)).toBe('$2.28')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pane counts tool calls and failures`, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('tool.call', (_$, e) =>
      e.tool_use_id === 'bad'
        ? { result: 'boom', isError: true, text: 'boom' }
        : { result: 'ok', text: 'ok' },
    )
    const ui = await $.ui.mount({
      plugin: 'session-stats',
      surface,
      component: 'Pane',
      requestId: 'session-stats',
      props: PANE,
    })
    expect(await ui.find({ text: /None this session/ })).toBeDefined()

    await $.tool.call({ tool: 'Read', tool_use_id: 'ok1', file_path: 'a.txt' })
    await $.tool.call({ tool: 'Read', tool_use_id: 'bad', file_path: 'b.txt' })

    expect(await ui.find({ text: /^2 · 1 failed$/ })).toBeDefined()
    expect(await ui.find({ text: /Read 2/ })).toBeDefined()
  })
}
