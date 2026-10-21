import type { EngineInterface } from 'claude-code'

import type { ServiceState, ServiceView } from '../types'

export type CheckSpec = { port: number; host?: string } | { http: string } | { command: string }

export type ServiceSpec = {
  name: string
  /** How to tell it is up. Without one, a service is up while the process desk started lives. */
  check?: CheckSpec
  /** A shell command that runs the service; desk runs it in the background and keeps its log. */
  start?: string
  /** A shell command that stops it; without one, desk stops the process group it started. */
  stop?: string
  /** Where the commands run, relative to the repository; the repository by default. */
  cwd?: string
}

export type DeskConfig = { issuePattern?: string; services: ServiceSpec[] }

/** The team's file, committed, then the person's own, which wins by service name. */
export const CONFIG_FILES = ['.claude/desk.json', '.claude/desk.local.json'] as const

export const TEMPLATE = `{
  "services": [
    {
      "name": "Database",
      "check": { "port": 5432 },
      "start": "docker compose up -d db",
      "stop": "docker compose stop db"
    },
    {
      "name": "Web",
      "check": { "http": "http://localhost:3000" },
      "start": "npm run dev"
    }
  ]
}
`

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseCheck(v: unknown, where: string): CheckSpec | string {
  if (!isRecord(v)) return `${where}: "check" must be an object`
  if (typeof v.port === 'number') {
    if (!Number.isInteger(v.port) || v.port < 1 || v.port > 65535) return `${where}: "port" must be 1 to 65535`
    return typeof v.host === 'string' ? { port: v.port, host: v.host } : { port: v.port }
  }
  if (typeof v.http === 'string') return /^https?:\/\//.test(v.http) ? { http: v.http } : `${where}: "http" must be an http(s) URL`
  if (typeof v.command === 'string') return { command: v.command }
  return `${where}: "check" needs "port", "http" or "command"`
}

/** Reads one config file's text; a problem names the file and what is wrong. */
export function parseConfig(text: string, file: string): { config: DeskConfig } | { problem: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { problem: `${file} is not valid JSON: ${String(err).replace(/^SyntaxError: /, '').slice(0, 100)}` }
  }
  if (!isRecord(raw)) return { problem: `${file} must hold a JSON object` }
  const config: DeskConfig = { services: [] }
  if (raw.issuePattern !== undefined) {
    if (typeof raw.issuePattern !== 'string') return { problem: `${file}: "issuePattern" must be a string` }
    try {
      new RegExp(raw.issuePattern)
    } catch {
      return { problem: `${file}: "issuePattern" is not a valid regular expression` }
    }
    config.issuePattern = raw.issuePattern
  }
  const services = raw.services ?? []
  if (!Array.isArray(services)) return { problem: `${file}: "services" must be a list` }
  for (const [i, s] of services.entries()) {
    const where = `${file} services[${i}]`
    if (!isRecord(s) || typeof s.name !== 'string' || s.name.trim() === '') return { problem: `${where} needs a "name"` }
    const spec: ServiceSpec = { name: s.name.trim() }
    if (s.check !== undefined) {
      const check = parseCheck(s.check, where)
      if (typeof check === 'string') return { problem: check }
      spec.check = check
    }
    for (const key of ['start', 'stop', 'cwd'] as const) {
      if (s[key] === undefined) continue
      if (typeof s[key] !== 'string') return { problem: `${where}: "${key}" must be a string` }
      spec[key] = s[key]
    }
    config.services.push(spec)
  }
  return { config }
}

/** Lays the person's file over the team's: same-named services replaced, new ones added. */
export function mergeConfigs(base: DeskConfig, over: DeskConfig): DeskConfig {
  const byName = new Map(base.services.map(s => [s.name, s]))
  for (const s of over.services) byName.set(s.name, s)
  return { issuePattern: over.issuePattern ?? base.issuePattern, services: [...byName.values()] }
}

/** Whether any service would run a command of the config's: what trust is asked for. */
export function hasCommands(config: DeskConfig): boolean {
  return config.services.some(s => s.start !== undefined || s.stop !== undefined || (s.check !== undefined && 'command' in s.check))
}

/** A short fingerprint of the config's text, so trust lapses when the commands change. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export type LoadedConfig = { config: DeskConfig; files: string[]; fingerprint: string; problem: string | null }

export async function loadConfig($: EngineInterface, root: string): Promise<LoadedConfig> {
  let config: DeskConfig = { services: [] }
  const files: string[] = []
  let text = ''
  for (const file of CONFIG_FILES) {
    const path = `${root}/${file}`
    if (!(await $.fs.exists(path))) continue
    let body: string
    try {
      body = await $.fs.read(path)
    } catch {
      return { config: { services: [] }, files, fingerprint: '', problem: `${file} could not be read` }
    }
    const parsed = parseConfig(body, file)
    if ('problem' in parsed) return { config: { services: [] }, files, fingerprint: '', problem: parsed.problem }
    config = mergeConfigs(config, parsed.config)
    files.push(file)
    text += `${file}\n${body}\n`
  }
  return { config, files, fingerprint: fingerprint(text), problem: null }
}

export function probeOf(spec: ServiceSpec): string {
  if (spec.check === undefined) return spec.start === undefined ? 'no check' : 'process'
  if ('port' in spec.check) return `${spec.check.host ?? ''}:${spec.check.port}`
  if ('http' in spec.check) return spec.check.http.replace(/^https?:\/\//, '')
  return 'command'
}

function cwdOf(root: string, spec: ServiceSpec): string {
  if (spec.cwd === undefined || spec.cwd === '' || spec.cwd === '.') return root
  return spec.cwd.startsWith('/') ? spec.cwd : `${root}/${spec.cwd}`
}

/** Whether the process group desk started is still running. */
export async function isAlive($: EngineInterface, pid: number): Promise<boolean> {
  try {
    return (await $.process.run(['sh', '-c', 'kill -0 "$1" 2>/dev/null', 'desk', String(pid)], { timeoutMs: 3000 })).exitCode === 0
  } catch {
    return false
  }
}

/**
 * Whether a service answers now. A command check runs only once the config
 * is trusted; untrusted, it reads as unknown.
 */
export async function probe(
  $: EngineInterface,
  root: string,
  spec: ServiceSpec,
  pid: number | null,
  isTrusted: boolean,
): Promise<'up' | 'down' | 'unknown'> {
  const check = spec.check
  try {
    if (check === undefined) return pid !== null && (await isAlive($, pid)) ? 'up' : pid === null && spec.start === undefined ? 'unknown' : 'down'
    if ('port' in check) {
      // Without a host, IPv4 then IPv6: a dev server on `localhost` (Vite, say) often listens on ::1 alone.
      const hosts = check.host === undefined ? ['127.0.0.1', '::1'] : [check.host]
      const r = await $.process.run(
        ['bash', '-c', 'p=$1; shift; for h; do (exec 3<>"/dev/tcp/$h/$p") 2>/dev/null && exit 0; done; exit 1', 'desk', String(check.port), ...hosts],
        { timeoutMs: 3000 },
      )
      return r.exitCode === 0 ? 'up' : 'down'
    }
    if ('http' in check) {
      await $.http.fetch(check.http)
      return 'up'
    }
    if (!isTrusted) return 'unknown'
    const r = await $.process.run(['sh', '-c', check.command], { cwd: cwdOf(root, spec), timeoutMs: 5000 })
    return r.exitCode === 0 ? 'up' : 'down'
  } catch {
    // A port check past its timeout, a refused connection, a check that hung: not up.
    return 'down'
  }
}

/** A file-name-safe form of a service's name. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service'
}

export function logPath(logDir: string, spec: ServiceSpec): string {
  return `${logDir}/${slug(spec.name)}.log`
}

/**
 * Runs the start command in the background, in a process group of its own
 * (so it can be stopped whole), detached from the session, its output in the
 * log. Resolves the group's id.
 */
export async function startService($: EngineInterface, root: string, logDir: string, spec: ServiceSpec): Promise<number> {
  if (spec.start === undefined) throw new Error(`${spec.name} has no start command`)
  // `set -m` gives the background job a process group of its own whose id is its pid.
  const script = 'set -m; mkdir -p "$(dirname "$3")" || exit 1; cd "$1" || exit 1; nohup sh -c "$2" >"$3" 2>&1 </dev/null & echo $!'
  const r = await $.process.run(['sh', '-c', script, 'desk', cwdOf(root, spec), spec.start, logPath(logDir, spec)], { timeoutMs: 10_000 })
  const pid = Number(r.stdout.trim())
  if (r.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(`${spec.name} did not start: ${(r.stderr.trim() || `exit ${r.exitCode}`).slice(0, 160)}`)
  }
  return pid
}

/** Stops a service: by its stop command, else by the process group desk started. */
export async function stopService($: EngineInterface, root: string, spec: ServiceSpec, pid: number | null): Promise<void> {
  if (spec.stop !== undefined) {
    const r = await $.process.run(['sh', '-c', spec.stop], { cwd: cwdOf(root, spec), timeoutMs: 60_000 })
    if (r.exitCode !== 0) throw new Error(`${spec.name}'s stop command failed: ${(r.stderr.trim() || `exit ${r.exitCode}`).slice(0, 160)}`)
    return
  }
  if (pid === null) throw new Error(`${spec.name} has no stop command, and desk did not start it`)
  await $.process.run(['sh', '-c', 'kill -TERM -- "-$1" 2>/dev/null || kill -TERM "$1" 2>/dev/null; true', 'desk', String(pid)], {
    timeoutMs: 5000,
  })
}

/** A service's state as the pane shows it, from its probe and what desk is doing to it. */
export function stateOf(
  probed: 'up' | 'down' | 'unknown',
  doing: { action: 'start' | 'stop'; since: number } | undefined,
  at: number,
): ServiceState {
  if (doing?.action === 'start' && probed !== 'up' && at - doing.since < 120_000) return 'starting'
  if (doing?.action === 'stop' && probed === 'up' && at - doing.since < 30_000) return 'stopping'
  return probed
}

export function viewOf(spec: ServiceSpec, state: ServiceState, pid: number | null, isTrusted: boolean): ServiceView {
  return {
    name: spec.name,
    state,
    pid,
    probe: probeOf(spec),
    canStart: isTrusted && spec.start !== undefined,
    canStop: isTrusted && (spec.stop !== undefined || pid !== null),
  }
}
