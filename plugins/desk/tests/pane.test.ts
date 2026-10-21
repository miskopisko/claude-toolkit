import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  title: 'Desk',
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const REFRESH = {
  command: 'desk',
  args: 'refresh',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

const STATUS = ['# branch.head implement/7-thing', '# branch.upstream origin/implement/7-thing', '# branch.ab +1 -0', '1 M. N... a b c d e f.ts'].join('\n')

const PR = {
  number: 12,
  title: 'Do the thing (#7)',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/o/r/pull/12',
  reviewDecision: 'REVIEW_REQUIRED',
  statusCheckRollup: [
    { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
  ],
  closingIssuesReferences: [{ number: 7 }],
}

const ISSUE = {
  number: 7,
  title: 'The thing',
  state: 'OPEN',
  url: 'https://github.com/o/r/issues/7',
  body: '## Acceptance criteria\n- [x] first\n- [ ] second\n- [ ] third',
  projectItems: [{ title: 'Board', status: { name: 'In progress' } }],
}

/** What the engine answers beneath the plugin in a session: commands, the pane, the store, files. */
function fakeSession(on: On) {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
}

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** git and gh as a repository with a PR and its issue answer them; `seen` collects each argv. */
function fakeHost(on: On, seen: string[][] = [], withPr = true, pr: object = PR, hasProjectScope = true) {
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    seen.push(argv)
    const line = argv.join(' ')
    if (line === 'git rev-parse --show-toplevel') return ok('/repo\n')
    if (line === 'git rev-parse --absolute-git-dir') return ok('/repo/.git\n')
    if (line.startsWith('git status')) return ok(STATUS)
    if (line.startsWith('gh repo view')) return ok(JSON.stringify({ owner: { login: 'o' }, name: 'r' }))
    if (line.startsWith('gh pr view')) return withPr ? ok(JSON.stringify(pr)) : fail('no pull requests found for branch "implement/7-thing"')
    if (line.startsWith('gh api graphql'))
      return ok(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } } } } }))
    if (line.startsWith('gh issue view') && line.includes('projectItems') && !hasProjectScope)
      return fail('error: your authentication token is missing required scopes [read:project]\nTo request it, run: gh auth refresh -s read:project')
    if (line.startsWith('gh issue view')) return ok(JSON.stringify(ISSUE))
    return fail(`unexpected: ${line}`)
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pane shows the branch, its issue's criteria and its PR`, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    fakeSession(on)
    fakeHost(on)
    await $.session.start({ cwd: '/repo', surface, isInteractive: false })
    const ui = await $.ui.mount({ plugin: 'desk', surface, component: 'Pane', requestId: 'desk', props: PANE })
    await $.command.run(REFRESH)

    expect(await ui.find({ text: 'implement/7-thing' })).toBeDefined()
    expect(await ui.find({ text: /↑1 · 1 staged/ })).toBeDefined()
    expect(await ui.find({ text: /The thing/ })).toBeDefined()
    expect(await ui.find({ text: /In progress \(Board\)/ })).toBeDefined()
    expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
    expect(await ui.find({ text: /second/ })).toBeDefined()
    expect(await ui.find({ text: /review required/ })).toBeDefined()
    expect(await ui.find({ text: /✓ 1 {2}✗ 1/ })).toBeDefined()
    expect(await ui.find({ text: /✗ lint/ })).toBeDefined()
    expect(await ui.find({ text: '1 unresolved' })).toBeDefined()
  })
}

test('with no PR, the issue comes from the branch name', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  fakeSession(on)
  const seen: string[][] = []
  fakeHost(on, seen, false)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  const ui = await $.ui.mount({ plugin: 'desk', surface: 'terminal', component: 'Pane', requestId: 'desk', props: PANE })
  await $.command.run(REFRESH)

  expect(await ui.find({ text: 'None for this branch.' })).toBeDefined()
  expect(await ui.find({ text: /The thing/ })).toBeDefined()
  expect(seen.some(a => a.join(' ').startsWith('gh issue view 7 '))).toBe(true)
})

test('without gh, the pane says so and git still shows', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  fakeSession(on)
  on('process.run', (_$, e) => {
    const line = e.argv.join(' ')
    if (line === 'git rev-parse --show-toplevel') return ok('/repo\n')
    if (line.startsWith('git status')) return ok(STATUS)
    if (e.argv[0] === 'gh') throw new Error('spawn gh ENOENT')
    return fail('')
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  const ui = await $.ui.mount({ plugin: 'desk', surface: 'terminal', component: 'Pane', requestId: 'desk', props: PANE })
  await $.command.run(REFRESH)

  expect(await ui.find({ text: 'implement/7-thing' })).toBeDefined()
  expect(await ui.find({ text: 'gh is not installed' })).toBeDefined()
})

test('a token without the project scope still reads the issue, without its board', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  fakeSession(on)
  const seen: string[][] = []
  fakeHost(on, seen, true, PR, false)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  const ui = await $.ui.mount({ plugin: 'desk', surface: 'terminal', component: 'Pane', requestId: 'desk', props: PANE })
  await $.command.run(REFRESH)

  expect(await ui.find({ text: /The thing/ })).toBeDefined()
  expect(seen.some(a => a.join(' ') === 'gh issue view 7 --json number,title,state,url,body')).toBe(true)
})

test('an issue the PR closes in another repository is passed over for the branch name', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  fakeSession(on)
  const seen: string[][] = []
  fakeHost(on, seen, true, { ...PR, closingIssuesReferences: [{ number: 99, repository: { name: 'elsewhere', owner: { login: 'o' } } }] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(REFRESH)

  expect(seen.some(a => a.join(' ').startsWith('gh issue view 7 '))).toBe(true)
  expect(seen.some(a => a.join(' ').startsWith('gh issue view 99 '))).toBe(false)
})

test('the left-off note rides beside the first prompt of a conversation only', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  fakeSession(on)
  fakeHost(on)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  const prompt = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  await prompt('hello')
  await prompt('again')
  expect(contexts[0]?.[0]).toContain('Branch: implement/7-thing')
  expect(contexts[1]).toBeUndefined()
})
