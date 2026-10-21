import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Crumb, GitState, ServiceView, StackView, Trail, WorkView } from '../types'
import { ago, bar, clip, criteriaCount, reviewWords } from './format'
import { gitDir, NO_GIT, readGit } from './git'
import { openInBrowser, readWork } from './github'
import {
  CONFIG_FILES,
  fingerprint,
  hasCommands,
  isAlive,
  loadConfig,
  logPath,
  probe,
  startService,
  stateOf,
  stopService,
  TEMPLATE,
  viewOf,
} from './stack'
import type { LoadedConfig, ServiceSpec } from './stack'
import { asTrail, leftOffNote, previousOf, withAnswer, withPrompt } from './trail'

const PANE = 'desk'
const TITLE = 'Desk'
const WIDTH = 46
const GUTTER = 1
/** How often the pane re-reads git and the services while it is drawn. */
const TICK_MS = 5000
/** How often it re-reads GitHub while drawn; a turn's end or a branch change reads it sooner. */
const WORK_EVERY_MS = 90_000
const WORK_AFTER_TURN_MS = 20_000
const CRITERIA_SHOWN = 8

const EMPTY_WORK: WorkView = { at: null, repo: null, issueNumber: null, issue: null, pr: null, problem: null, isLoading: false }
const EMPTY_STACK: StackView = { files: [], isTrusted: false, services: [], problem: null }

const git = atom({ plugin: 'desk', key: 'git' } as const, NO_GIT)
const work = atom({ plugin: 'desk', key: 'work' } as const, EMPTY_WORK)
const stack = atom({ plugin: 'desk', key: 'stack' } as const, EMPTY_STACK)
const previous = atom({ plugin: 'desk', key: 'previous' } as const, null as Crumb | null)
const now = atom({ plugin: 'desk', key: 'now' } as const, 0)
const notedSession = atom({ plugin: 'desk', key: 'notedSession' } as const, null as string | null)

/** Store keys, each per repository (or per folder outside one). */
const keys = {
  trail: (root: string) => `trail:${root}`,
  work: (root: string) => `work:${root}`,
  pids: (root: string) => `pids:${root}`,
  trust: (root: string) => `trust:${root}`,
  card: 'card',
}

type Pids = Record<string, number>

/** What the module keeps between hooks; a reload starts it over from the store. */
const rt = {
  cwd: null as string | null,
  logDir: null as string | null,
  config: null as LoadedConfig | null,
  doing: new Map<string, { action: 'start' | 'stop'; since: number }>(),
  workBranch: undefined as string | null | undefined,
  /** The GitHub read under way, if one is. */
  workRead: null as Promise<void> | null,
  /** When the last GitHub read began. */
  lastWorkAt: 0,
  isProbing: false,
}

/** The key a repository's records go under: its top level, else the session's folder. */
async function placeOf($: EngineInterface): Promise<string> {
  const g = await read($, git)
  return g.root ?? rt.cwd ?? (await $.session.cwd())
}

async function refreshGit($: EngineInterface): Promise<GitState> {
  const cwd = rt.cwd ?? (await $.session.cwd())
  const g = await readGit($, cwd)
  await update($, git, () => g)
  if (g.root !== null && rt.workBranch !== undefined && g.branch !== rt.workBranch) void refreshWork($)
  return g
}

/**
 * Reads GitHub again. One read runs at a time: an unforced call while one is
 * under way does nothing, and a forced one (a refresh asked for) waits for it
 * and reads once more, so what it shows is from after the ask.
 */
async function refreshWork($: EngineInterface, isForced = false) {
  while (rt.workRead !== null) {
    if (!isForced) return
    await rt.workRead.catch(() => undefined)
  }
  rt.workRead = (async () => {
    const g = await read($, git)
    if (g.root === null) return
    const root = g.root
    await update($, work, w => ({ ...w, isLoading: true }))
    const at = await $.clock.now()
    rt.lastWorkAt = at
    const w = await readWork($, root, g.branch, rt.config?.config.issuePattern, at)
    rt.workBranch = g.branch
    await update($, work, () => w)
    if (w.problem === null) await $.store.set(keys.work(root), { ...w, branch: g.branch })
  })()
  try {
    await rt.workRead
  } finally {
    rt.workRead = null
  }
}

/** Where service logs go: the repository's git directory, else a temporary folder, never the project tree. */
async function logDirOf($: EngineInterface, root: string): Promise<string> {
  const dir = await gitDir($, root)
  if (dir !== null) return `${dir}/desk`
  let tmp: string | undefined
  try {
    tmp = await $.env.get('TMPDIR')
  } catch {
    tmp = undefined
  }
  return `${(tmp ?? '/tmp').replace(/\/+$/, '')}/claude-desk-logs/${fingerprint(root)}`
}

async function loadStack($: EngineInterface) {
  const root = await placeOf($)
  rt.config = await loadConfig($, root)
  rt.logDir = await logDirOf($, root)
  await probeServices($)
}

async function isTrusted($: EngineInterface, cfg: LoadedConfig): Promise<boolean> {
  if (!hasCommands(cfg.config)) return true
  return (await $.store.get(keys.trust(await placeOf($)))) === cfg.fingerprint
}

async function readPids($: EngineInterface): Promise<Pids> {
  const v = await $.store.get(keys.pids(await placeOf($)))
  return typeof v === 'object' && v !== null ? (v as Pids) : {}
}

async function writePids($: EngineInterface, change: (p: Pids) => Pids) {
  const root = await placeOf($)
  const next = change(await readPids($))
  if (Object.keys(next).length === 0) await $.store.delete(keys.pids(root))
  else await $.store.set(keys.pids(root), next)
}

async function probeServices($: EngineInterface) {
  const cfg = rt.config
  if (cfg === null || rt.isProbing) return
  rt.isProbing = true
  try {
    const root = await placeOf($)
    const trusted = await isTrusted($, cfg)
    const pids = await readPids($)
    const at = await $.clock.now()
    const views: ServiceView[] = await Promise.all(
      cfg.config.services.map(async spec => {
        const pid = pids[spec.name] ?? null
        const probed = await probe($, root, spec, pid, trusted)
        const doing = rt.doing.get(spec.name)
        const state = stateOf(probed, doing, at)
        if (doing !== undefined && state !== 'starting' && state !== 'stopping') rt.doing.delete(spec.name)
        return viewOf(spec, state, pid, trusted)
      }),
    )
    // A process desk started that has exited is forgotten, so its stop is not offered. One still
    // running whose check does not answer (slow, or checked at the wrong port) keeps its pid.
    const quiet = views.filter(v => v.pid !== null && v.state === 'down')
    const exited = await Promise.all(quiet.map(async v => !(await isAlive($, v.pid!))))
    const gone = quiet.filter((_, i) => exited[i]).map(v => v.name)
    if (gone.length > 0) await writePids($, p => Object.fromEntries(Object.entries(p).filter(([n]) => !gone.includes(n))))
    await update($, stack, () => ({
      files: cfg.files,
      isTrusted: trusted,
      services: views.map(v => (gone.includes(v.name) ? { ...v, pid: null, canStop: v.canStop && cfg.config.services.find(s => s.name === v.name)?.stop !== undefined } : v)),
      problem: cfg.problem,
    }))
  } finally {
    rt.isProbing = false
  }
}

function specNamed(name: string): ServiceSpec | undefined {
  const want = name.toLowerCase()
  return rt.config?.config.services.find(s => s.name.toLowerCase() === want)
}

/** The services a command's words name: all the words as one name (`Web App`), else each word as one. */
function specsNamed(words: string[]): (ServiceSpec | undefined)[] {
  const whole = specNamed(words.join(' '))
  return whole !== undefined ? [whole] : words.map(specNamed)
}

/** Whether a service reads as running: up, starting, or a process desk started still alive. */
function isRunning(v: ServiceView | undefined): boolean {
  return v !== undefined && (v.state === 'up' || v.state === 'starting' || v.pid !== null)
}

/** Starts or stops one service; resolves what happened, in a line. */
async function act($: EngineInterface, spec: ServiceSpec, action: 'start' | 'stop'): Promise<string> {
  const cfg = rt.config
  if (cfg === null) return 'No desk config is loaded.'
  if (!(await isTrusted($, cfg))) return `The desk config's commands are not trusted yet: read ${cfg.files.join(' and ')}, then /stack trust.`
  const root = await placeOf($)
  const at = await $.clock.now()
  const logDir = rt.logDir ?? (await logDirOf($, root))
  try {
    if (action === 'start') {
      if (spec.start === undefined) return `${spec.name} has no start command.`
      const view = (await read($, stack)).services.find(v => v.name === spec.name)
      if (view?.state === 'up' || view?.state === 'starting') return `${spec.name} is already ${view.state}.`
      if (view?.pid != null) return `${spec.name} is still running (process group ${view.pid}) but its check does not answer: /stack down ${spec.name} first.`
      const pid = await startService($, root, logDir, spec)
      await writePids($, p => ({ ...p, [spec.name]: pid }))
      rt.doing.set(spec.name, { action, since: at })
      return `${spec.name} starting (process group ${pid}); its log is ${logPath(logDir, spec)}.`
    }
    const pid = (await readPids($))[spec.name] ?? null
    await stopService($, root, spec, pid)
    await writePids($, p => Object.fromEntries(Object.entries(p).filter(([n]) => n !== spec.name)))
    rt.doing.set(spec.name, { action, since: at })
    return `${spec.name} stopping.`
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  } finally {
    await probeServices($)
  }
}

async function toggle($: EngineInterface, name: string) {
  const spec = specNamed(name)
  if (spec === undefined) return
  const view = (await read($, stack)).services.find(s => s.name === spec.name)
  const line = await act($, spec, isRunning(view) ? 'stop' : 'start')
  $.ui.toast(`desk: ${line}`)
}

async function trust($: EngineInterface): Promise<string> {
  const cfg = rt.config
  if (cfg === null || cfg.files.length === 0) return `No desk config here. /stack init writes ${CONFIG_FILES[0]} to start from.`
  await $.store.set(keys.trust(await placeOf($)), cfg.fingerprint)
  await probeServices($)
  return `Trusted the commands in ${cfg.files.join(' and ')}. A change to either file asks again.`
}

// The pane's clock: one tick every few seconds, run only while the pane is drawn.
let ticker: Timer | null = null

function startTicker($: EngineInterface) {
  if (ticker !== null) return
  ticker = $.clock.every(TICK_MS, async () => {
    const at = await $.clock.now()
    await update($, now, () => at)
    await refreshGit($)
    // The config is re-read too, so an edit to it shows without a refresh.
    rt.config = await loadConfig($, await placeOf($))
    await probeServices($)
    if (at - rt.lastWorkAt >= WORK_EVERY_MS) await refreshWork($)
  })
}

function stopTicker() {
  ticker?.cancel()
  ticker = null
}

async function recordTrail($: EngineInterface, change: (t: Trail | null, sessionId: string, at: number) => Trail) {
  const root = await placeOf($)
  const [sessionId, at, stored] = await Promise.all([$.session.id(), $.clock.now(), $.store.get(keys.trail(root))])
  await $.store.set(keys.trail(root), change(asTrail(stored), sessionId, at))
}

/**
 * The where-you-left-off note for this conversation: made once per session id
 * (a /clear starts another), null when off, already sent, or with nothing to say. It reads the trail before this prompt is recorded.
 */
async function makeNote($: EngineInterface): Promise<string | null> {
  const sessionId = await $.session.id()
  if ((await read($, notedSession)) === sessionId) return null
  await update($, notedSession, () => sessionId)
  if ((await $.store.get(keys.card)) === false) return null
  const g = await refreshGit($)
  const root = g.root ?? rt.cwd ?? (await $.session.cwd())
  const [trail, cached, at] = await Promise.all([
    $.store.get(keys.trail(root)),
    $.store.get(keys.work(root)),
    $.clock.now(),
  ])
  const live = await read($, work)
  const c = cached as (WorkView & { branch: string | null }) | undefined
  const w = live.at !== null ? live : c !== undefined && c.branch === g.branch ? c : null
  return leftOffNote(g, w, previousOf(asTrail(trail), sessionId), at)
}

function stateColor(state: ServiceView['state']): string | undefined {
  return state === 'up' ? 'success' : state === 'down' ? 'error' : state === 'unknown' ? undefined : 'warning'
}

function stateMark(state: ServiceView['state']): string {
  return state === 'up' ? '●' : state === 'down' ? '○' : state === 'unknown' ? '?' : '◐'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'desk',
      description: 'Open the desk pane: issue, PR and services for this branch (close, refresh, note on|off)',
      argumentHint: '[close | refresh | note on|off]',
    })
    await $.command.register({
      name: 'stack',
      description: 'Your local dev services: status, up and down by name, logs, trust, init',
      argumentHint: '[status | up|down [name…] | logs <name> | trust | init]',
    })
    rt.cwd = e.cwd
    const g = await refreshGit($)
    const root = g.root ?? e.cwd
    const [sessionId, trail, cached] = await Promise.all([$.session.id(), $.store.get(keys.trail(root)), $.store.get(keys.work(root))])
    await update($, previous, () => previousOf(asTrail(trail), sessionId))
    // The last read, shown until the first new one lands.
    const c = cached as (WorkView & { branch: string | null }) | undefined
    if (c !== undefined && c.branch === g.branch) await update($, work, () => ({ ...c, isLoading: true }))
    await loadStack($)
    void refreshWork($)

    // Unasked, the pane is placed only on a wide terminal; its first draw starts the clock.
    if (e.isInteractive) void $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })
    return next(e)
  })

  on('command.run', { command: 'desk' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(w => w !== '')
    if (words[0] === 'close') {
      await $.ui.close({ id: PANE })
      stopTicker()
      return { text: 'Desk pane closed.' }
    }
    if (words[0] === 'refresh') {
      await refreshGit($)
      await Promise.all([refreshWork($, true), loadStack($)])
      return { text: 'Desk refreshed.' }
    }
    if (words[0] === 'note') {
      if (words[1] !== 'on' && words[1] !== 'off') {
        const isOff = (await $.store.get(keys.card)) === false
        return { text: `The where-you-left-off note is ${isOff ? 'off' : 'on'}: /desk note on|off` }
      }
      if (words[1] === 'on') await $.store.delete(keys.card)
      else await $.store.set(keys.card, false)
      return { text: `The where-you-left-off note is ${words[1]}, from the next conversation.` }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })
    return {
      text: opened.isPlaced ? 'Desk pane opened. In fullscreen mode it docks on the right.' : `Desk pane is waiting to be placed: ${opened.reason}`,
    }
  })

  on('command.run', { command: 'stack' }, async ($, e) => {
    const [verb = 'status', ...names] = e.args.trim().split(/\s+/).filter(w => w !== '')
    const root = await placeOf($)
    if (verb === 'init') {
      const path = `${root}/${CONFIG_FILES[0]}`
      if (await $.fs.exists(path)) return { text: `${CONFIG_FILES[0]} is there already.` }
      try {
        // fs.write makes .claude/ when it is not there yet.
        await $.fs.write(path, TEMPLATE)
      } catch (err) {
        return { text: `Could not write ${CONFIG_FILES[0]}: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}` }
      }
      await loadStack($)
      return {
        text: `Wrote ${CONFIG_FILES[0]} with two example services: edit it for this project. Commit it to share with the team; put your own services in ${CONFIG_FILES[1]}.`,
      }
    }
    if (rt.config === null) await loadStack($)
    const cfg = rt.config!
    if (cfg.problem !== null) return { text: `The desk config has a problem: ${cfg.problem}` }
    if (cfg.files.length === 0) return { text: `No services set up here. /stack init writes ${CONFIG_FILES[0]} to start from.` }
    if (verb === 'trust') return { text: await trust($) }
    if (verb === 'status') {
      await probeServices($)
      const s = await read($, stack)
      const lines = s.services.map(v => `${v.name}: ${v.state} (${v.probe}${v.pid === null ? '' : `, pid ${v.pid}`})`)
      if (!s.isTrusted) lines.push(`Commands not trusted yet: read ${s.files.join(' and ')}, then /stack trust.`)
      return { text: lines.join('\n') }
    }
    if (verb === 'logs') {
      const spec = specNamed(names.join(' '))
      if (spec === undefined) return { text: `No service named "${names.join(' ')}".` }
      const path = logPath(rt.logDir ?? (await logDirOf($, root)), spec)
      if (!(await $.fs.exists(path))) return { text: `${spec.name} has no log yet (desk keeps one for services it starts).` }
      const tail = (await $.fs.read(path)).split('\n').slice(-40).join('\n')
      return { text: `${path}, last lines:\n${tail}` }
    }
    if (verb === 'up' || verb === 'down') {
      await probeServices($)
      const views = (await read($, stack)).services
      const picked =
        names.length === 0
          ? cfg.config.services.filter(s => {
              const v = views.find(x => x.name === s.name)
              return verb === 'up' ? v?.state === 'down' && v.pid === null && s.start !== undefined : isRunning(v) && v!.canStop
            })
          : specsNamed(names)
      if (picked.some(s => s === undefined)) return { text: `No such service. The services: ${cfg.config.services.map(s => s.name).join(', ')}.` }
      if (picked.length === 0) return { text: verb === 'up' ? 'Nothing to start: every service is up or has no start command.' : 'Nothing desk can stop is running.' }
      const lines: string[] = []
      for (const spec of picked) lines.push(await act($, spec!, verb === 'up' ? 'start' : 'stop'))
      return { text: lines.join('\n') }
    }
    return { text: 'Usage: /stack [status | up [name…] | down [name…] | logs <name> | trust | init]' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    stopTicker()
    return closed
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.isMeta !== true && e.command === undefined && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')
    if (!isPerson) return next(e)
    // The note rides beside the conversation's first prompt, read by the model alone.
    const note = await makeNote($)
    const entered = await next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
    const branch = (await read($, git)).branch
    await recordTrail($, (t, id, at) => withPrompt(t, id, at, e.text, branch))
    return entered
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const g = await refreshGit($)
    const at = await $.clock.now()
    if (at - rt.lastWorkAt >= WORK_AFTER_TURN_MS) void refreshWork($)
    if (!e.isAborted) {
      const w = await read($, work)
      await recordTrail($, (t, id, when) => withAnswer(t, id, when, e.answer, g.branch, w))
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    startTicker($)
    const { Box, Button, Text } = $.ui.resolve(e)
    const [g, w, s, prev, tickAt] = await Promise.all([read($, git), read($, work), read($, stack), read($, previous), read($, now)])
    const at = Math.max(tickAt, await $.clock.now())
    const cols = Math.max(24, e.props.bodyColumns - GUTTER)
    const barWidth = Math.max(6, Math.min(20, cols - 22))
    const root = g.root

    const head = (text: string, aside?: string) => (
      <Box marginTop={1}>
        <Text bold color="claude">
          {text}
        </Text>
        {aside !== undefined && <Text dimColor> {aside}</Text>}
      </Box>
    )
    const row = (label: string, value: string, color?: string) => (
      <Box>
        <Box width={10} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text color={color} wrap="truncate-end">
          {value}
        </Text>
      </Box>
    )

    const tree = [
      g.ahead > 0 ? `↑${g.ahead}` : null,
      g.behind > 0 ? `↓${g.behind}` : null,
      g.staged > 0 ? `${g.staged} staged` : null,
      g.changed > 0 ? `${g.changed} changed` : null,
      g.untracked > 0 ? `${g.untracked} new` : null,
    ].filter(p => p !== null)

    const issue = w.issue
    const count = issue === null ? null : criteriaCount(issue.criteria)
    const pr = w.pr
    const checks = pr?.checks
    const checkLine =
      checks === undefined
        ? ''
        : [
            checks.passed > 0 ? `✓ ${checks.passed}` : null,
            checks.failed > 0 ? `✗ ${checks.failed}` : null,
            checks.running > 0 ? `● ${checks.running}` : null,
            checks.skipped > 0 ? `${checks.skipped} skipped` : null,
          ]
            .filter(p => p !== null)
            .join('  ') || 'none'
    const fresh = w.at === null ? (w.isLoading ? 'reading…' : '') : `${ago(at - w.at)} ago${w.isLoading ? ' · reading…' : ''}`

    return (
      <Box flexDirection="column" width={cols + GUTTER} paddingLeft={GUTTER}>
        <Text bold>Branch</Text>
        {root === null ? (
          <Text dimColor>Not a git repository.</Text>
        ) : (
          <>
            <Text wrap="truncate-end">{g.branch ?? '(detached HEAD)'}</Text>
            <Text dimColor wrap="truncate-end">
              {tree.length === 0 ? 'clean' : tree.join(' · ')}
              {g.upstream === null && g.branch !== null ? ' · not pushed' : ''}
            </Text>
          </>
        )}

        {root !== null && head('Issue', w.issueNumber === null ? undefined : fresh)}
        {root !== null &&
          (w.problem !== null ? (
            <Text color="warning" wrap="wrap">
              {w.problem}
            </Text>
          ) : issue === null ? (
            <Text dimColor wrap="wrap">
              {w.issueNumber !== null
                ? w.isLoading
                  ? `Reading #${w.issueNumber}…`
                  : `#${w.issueNumber} was not found.`
                : w.isLoading && w.at === null
                  ? 'Reading GitHub…'
                  : 'The branch names no issue, and no PR links one.'}
            </Text>
          ) : (
            <>
              <Box>
                <Button key="issue-number" plain label={`#${issue.number}`} onPress={() => openInBrowser($, root!, 'issue', issue.number)} />
                <Text wrap="truncate-end"> {issue.title}</Text>
              </Box>
              <Text dimColor wrap="truncate-end">
                {issue.state.toLowerCase()}
                {issue.columns.map(c => ` · ${c.status} (${c.project})`).join('')}
              </Text>
              {count === null ? (
                <Text dimColor>No checklist in the issue.</Text>
              ) : (
                <>
                  <Box>
                    <Text color={count.done === count.total ? 'success' : 'claude'}>{bar(count.done, count.total, barWidth)}</Text>
                    <Text>
                      {' '}
                      {count.done}/{count.total}
                    </Text>
                    <Text dimColor>{issue.criteriaSource === 'acceptance' ? ' criteria' : ' boxes'}</Text>
                  </Box>
                  {issue.criteria.slice(0, CRITERIA_SHOWN).map((c, i) => (
                    <Text key={`c${i}`} wrap="truncate-end" dimColor={c.isDone}>
                      <Text color={c.isDone ? 'success' : undefined}>{c.isDone ? '✓' : '○'}</Text> {c.text}
                    </Text>
                  ))}
                  {issue.criteria.length > CRITERIA_SHOWN && <Text dimColor>+{issue.criteria.length - CRITERIA_SHOWN} more</Text>}
                </>
              )}
            </>
          ))}

        {root !== null && w.problem === null && head('Pull request')}
        {root !== null &&
          w.problem === null &&
          (pr === null ? (
            <Text dimColor>{w.at === null ? 'Reading GitHub…' : g.branch === null ? 'No branch.' : 'None for this branch.'}</Text>
          ) : (
            <>
              <Box>
                <Button key="pr-number" plain label={`#${pr.number}`} onPress={() => openInBrowser($, root!, 'pr', pr.number)} />
                <Text wrap="truncate-end"> {pr.title}</Text>
              </Box>
              {row(
                'State',
                `${pr.isDraft ? 'draft' : pr.state.toLowerCase()}${pr.state === 'OPEN' ? ` · ${reviewWords(pr.review)}` : ''}`,
                pr.state === 'MERGED' ? 'success' : pr.review === 'CHANGES_REQUESTED' ? 'error' : pr.review === 'APPROVED' ? 'success' : undefined,
              )}
              {row('Checks', checkLine, checks!.failed > 0 ? 'error' : checks!.running > 0 ? 'warning' : checks!.passed > 0 ? 'success' : undefined)}
              {checks!.failing.slice(0, 3).map((name, i) => (
                <Text key={`f${i}`} color="error" wrap="truncate-end">
                  {'          '}✗ {name}
                </Text>
              ))}
              {pr.state === 'OPEN' &&
                row(
                  'Threads',
                  pr.unresolved === null ? 'unknown' : pr.unresolved === 0 ? 'all resolved' : `${pr.unresolved} unresolved`,
                  pr.unresolved !== null && pr.unresolved > 0 ? 'warning' : undefined,
                )}
            </>
          ))}

        {(s.services.length > 0 || s.problem !== null) && head('Services', s.files.length === 0 ? undefined : s.isTrusted ? undefined : 'not trusted')}
        {s.problem !== null && (
          <Text color="warning" wrap="wrap">
            {s.problem}
          </Text>
        )}
        {s.services.map((v, i) => {
          const canPress = isRunning(v) ? v.canStop : v.state === 'down' ? v.canStart : false
          const verb = isRunning(v) ? 'stop' : 'start'
          return (
            <Box key={`s${v.name}`}>
              <Box width={cols - 9} flexShrink={0}>
                <Text wrap="truncate-end">
                  <Text color={stateColor(v.state)}>{stateMark(v.state)}</Text> {v.name}{' '}
                  <Text dimColor>
                    {v.state === 'up' || v.state === 'down' ? v.probe : `${v.state}…`}
                  </Text>
                </Text>
              </Box>
              {canPress && i < 9 && (
                <Button key={`svc-${v.name}`} plain hotkey={String(i + 1)} label={verb} onPress={() => toggle($, v.name)} />
              )}
            </Box>
          )
        })}
        {s.services.length > 0 && !s.isTrusted && (
          <Button key="trust" plain hotkey="t" label={`trust ${s.files.join(' + ')}`} onPress={async () => $.ui.toast(`desk: ${await trust($)}`)} />
        )}

        {prev !== null && head('Last session', `${ago(at - prev.at)} ago`)}
        {prev !== null && (
          <>
            {prev.branch !== null && prev.branch !== g.branch && <Text dimColor wrap="truncate-end">on {prev.branch}</Text>}
            {prev.prompts.slice(-2).map((p, i) => (
              <Text key={`p${i}`} wrap="truncate-end">
                <Text dimColor>›</Text> {clip(p, 120)}
              </Text>
            ))}
          </>
        )}

        {root !== null && (
          <Box marginTop={1}>
            <Box marginRight={3} flexShrink={0}>
              <Button key="refresh" plain hotkey="r" label="refresh" onPress={() => Promise.all([refreshGit($), refreshWork($, true), loadStack($)])} />
            </Box>
            {issue !== null && (
              <Box marginRight={3} flexShrink={0}>
                <Button key="open-issue" plain hotkey="i" label="issue" onPress={() => openInBrowser($, root, 'issue', issue.number)} />
              </Box>
            )}
            {pr !== null && <Button key="open-pr" plain hotkey="p" label="PR" onPress={() => openInBrowser($, root, 'pr', pr.number)} />}
          </Box>
        )}
        {root !== null && <Text dimColor>Click, or ctrl+x tab then the key.</Text>}
      </Box>
    )
  })
}
