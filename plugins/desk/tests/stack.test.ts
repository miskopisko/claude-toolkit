import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const CONFIG = JSON.stringify({
  services: [
    { name: 'DB', check: { port: 5432 }, start: 'docker start db', stop: 'docker stop db' },
    { name: 'Web', check: { port: 3000 }, start: 'npm run dev', cwd: 'web' },
  ],
})

const run = (exitCode: number, stdout = '', stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const command = (args: string) => ({
  command: 'stack',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

/** A repository at /repo with a desk config, nothing listening, and every command recorded. */
function fakeRepo(on: On, seen: string[][]) {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/repo/.claude/desk.json' }))
  on('fs.read', () => ({ value: CONFIG }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    seen.push(argv)
    const line = argv.join(' ')
    if (line === 'git rev-parse --show-toplevel') return run(0, '/repo\n')
    if (line === 'git rev-parse --absolute-git-dir') return run(0, '/repo/.git\n')
    if (line.startsWith('git status')) return run(0, '# branch.head main\n')
    if (argv[0] === 'bash') return run(1) // nothing listens
    if (argv[0] === 'sh' && argv[3] === 'desk' && argv[5] === 'npm run dev') return run(0, '4242\n')
    if (argv[0] === 'gh') return run(1, '', 'no git remotes found')
    return run(0)
  })
}

test('service commands wait for trust, then start in the background with a log', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  fakeRepo(on, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })

  const before = await $.command.run(command('up Web'))
  expect(before.text).toContain('not trusted yet')
  expect(seen.some(a => a.includes('npm run dev'))).toBe(false)

  expect((await $.command.run(command('trust'))).text).toContain('Trusted the commands in .claude/desk.json')

  const started = await $.command.run(command('up Web'))
  expect(started.text).toContain('Web starting (process group 4242)')
  const start = seen.find(a => a.includes('npm run dev'))!
  expect(start.slice(4)).toEqual(['/repo/web', 'npm run dev', '/repo/.git/desk/web.log'])

  const status = await $.command.run(command('status'))
  expect(status.text).toContain('Web: starting')
  expect(status.text).toContain('DB: down (:5432)')
})

test('a stop command runs as written; the stack has none to guess', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  fakeRepo(on, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('trust'))

  expect((await $.command.run(command('down DB'))).text).toBe('DB stopping.')
  expect(seen.some(a => a.join(' ') === 'sh -c docker stop db')).toBe(true)
  expect((await $.command.run(command('down Nope'))).text).toContain('No such service')
})

test('the left-off note rides beside the first prompt of a conversation only', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  fakeRepo(on, [])
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  const prompt = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  await prompt('hello')
  await prompt('again')
  expect(contexts[0]?.[0]).toContain('Branch: main')
  expect(contexts[1]).toBeUndefined()
})
