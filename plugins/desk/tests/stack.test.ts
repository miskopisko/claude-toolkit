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

type Repo = {
  /** The files there, by absolute path; a test may change one between commands. */
  files: Record<string, string>
  /** The ports something listens on. */
  listening?: number[]
  /** Whether a process desk started is still running. */
  isAlive?: boolean
  /** Whether /repo is a git repository (where the logs go). */
  isGit?: boolean
  /** Whether a write is refused. */
  isReadOnly?: boolean
}

/** A repository at /repo with a desk config, and every command recorded. */
function fakeRepo(on: On, seen: string[][], repo: Repo = { files: { '/repo/.claude/desk.json': CONFIG } }) {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('fs.exists', (_$, e) => ({ value: e.path in repo.files }))
  on('fs.read', (_$, e) => ({ value: repo.files[e.path] ?? '' }))
  on('fs.write', (_$, e) => {
    if (repo.isReadOnly === true) throw new Error('EACCES: permission denied')
    repo.files[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    seen.push(argv)
    const line = argv.join(' ')
    if (line === 'git rev-parse --show-toplevel') return repo.isGit === false ? run(128) : run(0, '/repo\n')
    if (line === 'git rev-parse --absolute-git-dir') return repo.isGit === false ? run(128) : run(0, '/repo/.git\n')
    if (line.startsWith('git status')) return run(0, '# branch.head main\n')
    if (argv[0] === 'bash') return run((repo.listening ?? []).includes(Number(argv[4])) ? 0 : 1)
    if (argv[0] === 'sh' && argv[2]?.startsWith('set -m')) return run(0, '4242\n')
    if (argv[0] === 'sh' && argv[2]?.startsWith('kill -0')) return run(repo.isAlive === false ? 1 : 0)
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

test('a port check with no host tries IPv4, then IPv6', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  fakeRepo(on, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('status'))
  expect(seen.find(a => a[0] === 'bash' && a[4] === '3000')?.slice(5)).toEqual(['127.0.0.1', '::1'])
})

test('a stop command runs as written; a name not in the config is refused', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  fakeRepo(on, seen)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('trust'))

  expect((await $.command.run(command('down DB'))).text).toBe('DB stopping.')
  expect(seen.some(a => a.join(' ') === 'sh -c docker stop db')).toBe(true)
  expect((await $.command.run(command('down Nope'))).text).toContain('No such service')
})

test('a service that is up is not started twice', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  fakeRepo(on, seen, { files: { '/repo/.claude/desk.json': CONFIG }, listening: [3000] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('trust'))

  expect((await $.command.run(command('up Web'))).text).toBe('Web is already up.')
  expect(seen.some(a => a.includes('npm run dev'))).toBe(false)
})

test('a process desk started keeps its stop while it runs, though its check does not answer', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  const repo: Repo = { files: { '/repo/.claude/desk.json': CONFIG } }
  fakeRepo(on, seen, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('trust'))
  await $.command.run(command('up Web'))
  await clock.advance(200_000)

  expect((await $.command.run(command('status'))).text).toContain('Web: down (:3000, pid 4242)')
  expect((await $.command.run(command('up Web'))).text).toContain('still running (process group 4242)')
  expect((await $.command.run(command('down'))).text).toBe('Web stopping.')
  expect(seen.some(a => a[2]?.startsWith('kill -TERM') && a[4] === '4242')).toBe(true)
})

test('a process desk started that has exited is forgotten', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const repo: Repo = { files: { '/repo/.claude/desk.json': CONFIG } }
  fakeRepo(on, [], repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('trust'))
  await $.command.run(command('up Web'))
  await clock.advance(200_000)
  repo.isAlive = false

  const status = (await $.command.run(command('status'))).text
  expect(status).toContain('Web: down (:3000)')
  expect(status).not.toContain('pid')
})

test('a command check waits for trust, and trust lapses when the config changes', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  const config = (cmd: string) => JSON.stringify({ services: [{ name: 'Queue', check: { command: cmd } }] })
  const repo: Repo = { files: { '/repo/.claude/desk.json': config('curl -s q') } }
  fakeRepo(on, seen, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })

  expect((await $.command.run(command('status'))).text).toContain('Queue: unknown')
  expect(seen.some(a => a.join(' ') === 'sh -c curl -s q')).toBe(false)

  await $.command.run(command('trust'))
  expect((await $.command.run(command('status'))).text).toContain('Queue: up')
  expect(seen.some(a => a.join(' ') === 'sh -c curl -s q')).toBe(true)

  repo.files['/repo/.claude/desk.json'] = config('rm -rf ~')
  await $.command.run({ ...command(''), command: 'desk', args: 'refresh' })
  const status = (await $.command.run(command('status'))).text
  expect(status).toContain('Queue: unknown')
  expect(status).toContain('Commands not trusted yet')
  expect(seen.some(a => a.join(' ') === 'sh -c rm -rf ~')).toBe(false)
})

test("the person's own file replaces a team service by name, and a spaced name is one service", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen: string[][] = []
  const local = JSON.stringify({ services: [{ name: 'Web', check: { port: 4000 } }, { name: 'Mock API', start: 'mock' }] })
  fakeRepo(on, seen, { files: { '/repo/.claude/desk.json': CONFIG, '/repo/.claude/desk.local.json': local } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('trust'))

  const status = (await $.command.run(command('status'))).text
  expect(status).toContain('Web: down (:4000)')
  expect(status).toContain('Mock API: down (process)')
  expect((await $.command.run(command('up Mock API'))).text).toContain('Mock API starting')
})

test('init writes the starting config, and says why when it cannot', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const repo: Repo = { files: {} }
  fakeRepo(on, [], repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })

  expect((await $.command.run(command('init'))).text).toContain('Wrote .claude/desk.json')
  expect(JSON.parse(repo.files['/repo/.claude/desk.json']!).services.length).toBe(2)
  expect((await $.command.run(command('init'))).text).toContain('is there already')

  delete repo.files['/repo/.claude/desk.json']
  repo.isReadOnly = true
  expect((await $.command.run(command('init'))).text).toContain('Could not write .claude/desk.json:')
})

test('outside a git repository, logs go to a temporary folder, not the project', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { TMPDIR: '/tmp/me/' })
  const seen: string[][] = []
  fakeRepo(on, seen, { files: { '/repo/.claude/desk.json': CONFIG }, isGit: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await $.command.run(command('trust'))
  await $.command.run(command('up Web'))

  const log = seen.find(a => a.includes('npm run dev'))!.at(-1)!
  expect(log).toMatch(/^\/tmp\/me\/claude-desk-logs\/[0-9a-f]{8}\/web\.log$/)
})
