import type { EngineInterface } from 'claude-code'

import type { CheckSummary, Criterion, IssueView, PrView, WorkView } from '../types'
import { issueFromBranch } from './git'

const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/

/** Drops the markdown that reads as noise in one line of a pane. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()
}

/**
 * The checklist an issue body holds: the checkboxes under its first heading
 * that says "acceptance" (to the next heading as high or higher), or, with no
 * such heading, every checkbox in the body.
 */
export function parseCriteria(body: string): { criteria: Criterion[]; source: IssueView['criteriaSource'] } {
  const lines = body.split(/\r?\n/)
  const all: Criterion[] = []
  const under: Criterion[] = []
  let level: number | null = null
  let isUnder = false
  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const depth = heading[1]!.length
      if (isUnder && level !== null && depth <= level) isUnder = false
      if (level === null && /acceptance/i.test(heading[2]!)) {
        level = depth
        isUnder = true
      }
      continue
    }
    const box = CHECKBOX.exec(line)
    if (box === null) continue
    const item = { text: plain(box[2]!), isDone: box[1] !== ' ' }
    all.push(item)
    if (isUnder) under.push(item)
  }
  if (under.length > 0) return { criteria: under, source: 'acceptance' }
  if (all.length > 0) return { criteria: all, source: 'all' }
  return { criteria: [], source: 'none' }
}

type RollupEntry = { name?: string; context?: string; status?: string; conclusion?: string; state?: string }

const RUNNING = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED'])
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const SKIPPED = new Set(['SKIPPED', 'NEUTRAL', 'STALE'])

/** Counts a PR's `statusCheckRollup` (check runs and commit statuses alike). */
export function summarizeChecks(rollup: readonly RollupEntry[]): CheckSummary {
  const sum: CheckSummary = { passed: 0, failed: 0, running: 0, skipped: 0, failing: [] }
  for (const c of rollup) {
    // A check run has `status` then `conclusion`; a commit status has `state` alone.
    const word = (c.status !== undefined && c.status !== 'COMPLETED' ? c.status : (c.conclusion ?? c.state ?? '')).toUpperCase()
    if (RUNNING.has(word) || word === '') sum.running += 1
    else if (FAILED.has(word)) {
      sum.failed += 1
      sum.failing.push(c.name ?? c.context ?? 'check')
    } else if (SKIPPED.has(word)) sum.skipped += 1
    else sum.passed += 1
  }
  return sum
}

/** Why a gh call failed, in the words the pane shows. */
function problemOf(stderr: string): string {
  if (/gh auth login|not logged in|authentication/i.test(stderr)) return 'gh is not signed in: run gh auth login'
  if (/not a git repository|no git remotes|none of the git remotes/i.test(stderr)) return 'no GitHub remote here'
  const line = stderr.trim().split('\n')[0] ?? ''
  return line === '' ? 'gh failed' : line.slice(0, 120)
}

class GhError extends Error {}

async function gh($: EngineInterface, cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const r = await $.process.run(['gh', ...args], { cwd, timeoutMs: 20_000, env: { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } })
    return { ok: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr }
  } catch (err) {
    // The command could not start: gh is not installed, or it hung.
    throw new GhError(/timed out|still running/i.test(String(err)) ? 'gh timed out' : 'gh is not installed')
  }
}

function json<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** Repositories already resolved, by the folder they were resolved for. */
const repos = new Map<string, { owner: string; name: string }>()

async function repoOf($: EngineInterface, root: string) {
  const known = repos.get(root)
  if (known !== undefined) return known
  const r = await gh($, root, ['repo', 'view', '--json', 'owner,name'])
  if (!r.ok) throw new GhError(problemOf(r.stderr))
  const v = json<{ owner: { login: string }; name: string }>(r.stdout)
  if (v === null) throw new GhError('gh answered something unreadable')
  const repo = { owner: v.owner.login, name: v.name }
  repos.set(root, repo)
  return repo
}

type PrJson = {
  number: number
  title: string
  state: string
  isDraft: boolean
  url: string
  reviewDecision: string | null
  statusCheckRollup: RollupEntry[] | null
  closingIssuesReferences: { number: number }[] | null
}

async function readPr($: EngineInterface, root: string, branch: string) {
  const r = await gh($, root, [
    'pr',
    'view',
    branch,
    '--json',
    'number,title,state,isDraft,url,reviewDecision,statusCheckRollup,closingIssuesReferences',
  ])
  if (!r.ok) {
    if (/no (open )?pull requests? found/i.test(r.stderr)) return null
    throw new GhError(problemOf(r.stderr))
  }
  return json<PrJson>(r.stdout)
}

const THREADS = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { reviewThreads(first: 100) { nodes { isResolved } } }
  }
}`

async function unresolvedThreads($: EngineInterface, root: string, repo: { owner: string; name: string }, number: number) {
  const r = await gh($, root, [
    'api',
    'graphql',
    '-f',
    `query=${THREADS}`,
    '-f',
    `owner=${repo.owner}`,
    '-f',
    `name=${repo.name}`,
    '-F',
    `number=${number}`,
  ])
  if (!r.ok) return null
  const v = json<{ data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved: boolean }[] } } } } }>(r.stdout)
  const nodes = v?.data?.repository?.pullRequest?.reviewThreads?.nodes
  return nodes === undefined ? null : nodes.filter(t => !t.isResolved).length
}

type IssueJson = {
  number: number
  title: string
  state: string
  url: string
  body: string
  projectItems?: { title: string; status?: { name: string } | null }[]
}

async function readIssue($: EngineInterface, root: string, number: number): Promise<IssueView | null> {
  // projectItems needs the token's `project` scope; without it, read the issue without its board.
  let r = await gh($, root, ['issue', 'view', String(number), '--json', 'number,title,state,url,body,projectItems'])
  if (!r.ok && /project/i.test(r.stderr)) r = await gh($, root, ['issue', 'view', String(number), '--json', 'number,title,state,url,body'])
  if (!r.ok) {
    if (/could not resolve|not found/i.test(r.stderr)) return null
    throw new GhError(problemOf(r.stderr))
  }
  const v = json<IssueJson>(r.stdout)
  if (v === null) return null
  const { criteria, source } = parseCriteria(v.body ?? '')
  return {
    number: v.number,
    title: v.title,
    state: v.state,
    url: v.url,
    columns: (v.projectItems ?? [])
      .filter(p => p.status?.name !== undefined)
      .map(p => ({ project: p.title, status: p.status!.name })),
    criteria,
    criteriaSource: source,
  }
}

/**
 * Reads the branch's PR and the issue it works on: the first issue the PR
 * closes, else the number in the branch's name.
 */
export async function readWork(
  $: EngineInterface,
  root: string,
  branch: string | null,
  issuePattern: string | undefined,
  at: number,
): Promise<WorkView> {
  const empty: WorkView = { at, repo: null, issueNumber: null, issue: null, pr: null, problem: null, isLoading: false }
  try {
    const repo = await repoOf($, root)
    const base = { ...empty, repo: `${repo.owner}/${repo.name}` }
    if (branch === null) return base
    const prJson = await readPr($, root, branch)
    const pr: PrView | null =
      prJson === null
        ? null
        : {
            number: prJson.number,
            title: prJson.title,
            state: prJson.state,
            isDraft: prJson.isDraft,
            url: prJson.url,
            review: prJson.reviewDecision === '' ? null : prJson.reviewDecision,
            checks: summarizeChecks(prJson.statusCheckRollup ?? []),
            unresolved: prJson.state === 'OPEN' ? await unresolvedThreads($, root, repo, prJson.number) : 0,
          }
    const issueNumber = prJson?.closingIssuesReferences?.[0]?.number ?? issueFromBranch(branch, issuePattern)
    const issue = issueNumber === null ? null : await readIssue($, root, issueNumber)
    return { ...base, issueNumber, issue, pr }
  } catch (err) {
    if (err instanceof GhError) return { ...empty, problem: err.message }
    return { ...empty, problem: `GitHub could not be read: ${String(err).slice(0, 100)}` }
  }
}

/** Opens a PR or issue in the browser through gh, which knows the platform's opener. */
export async function openInBrowser($: EngineInterface, root: string, kind: 'pr' | 'issue', number: number) {
  try {
    await gh($, root, [kind, 'view', String(number), '--web'])
  } catch {
    // No gh: nothing to open it with; the pane already says gh is missing.
  }
}
