import type { Crumb, GitState, Trail, WorkView } from '../types'
import { ago, clip, criteriaCount } from './format'

const PROMPTS_KEPT = 5
/** Sessions kept per repository, so two open at once each keep their own crumb. */
const SESSIONS_KEPT = 5

/** A trail as the store holds it; one kept as `{ current, previous }` by an earlier desk reads as its crumbs. */
export function asTrail(stored: unknown): Trail | null {
  if (typeof stored !== 'object' || stored === null) return null
  const v = stored as { crumbs?: unknown; current?: Crumb | null; previous?: Crumb | null }
  if (Array.isArray(v.crumbs)) return { crumbs: v.crumbs as Crumb[] }
  return { crumbs: [v.current, v.previous].filter((c): c is Crumb => c != null) }
}

function crumbFor(trail: Trail | null, sessionId: string, at: number): Crumb {
  return trail?.crumbs.find(c => c.sessionId === sessionId) ?? { sessionId, at, branch: null, prompts: [], lastAnswer: null, issue: null, pr: null }
}

/** The trail with this session's crumb, changed, first. */
function withCrumb(trail: Trail | null, crumb: Crumb): Trail {
  const others = (trail?.crumbs ?? []).filter(c => c.sessionId !== crumb.sessionId)
  return { crumbs: [crumb, ...others].slice(0, SESSIONS_KEPT) }
}

/** The trail with a prompt added to this session's crumb. */
export function withPrompt(trail: Trail | null, sessionId: string, at: number, text: string, branch: string | null): Trail {
  const crumb = crumbFor(trail, sessionId, at)
  const line = clip(text.replace(/\s+/g, ' ').trim(), 200)
  if (line === '') return trail ?? { crumbs: [] }
  return withCrumb(trail, { ...crumb, at, branch, prompts: [...crumb.prompts, line].slice(-PROMPTS_KEPT) })
}

/** The trail with this session's last answer and where the work stood. */
export function withAnswer(
  trail: Trail | null,
  sessionId: string,
  at: number,
  answer: string,
  branch: string | null,
  work: WorkView,
): Trail {
  const crumb = crumbFor(trail, sessionId, at)
  const first = answer.trim().split('\n').find(l => l.trim() !== '')
  return withCrumb(trail, {
    ...crumb,
    at,
    branch,
    lastAnswer: first === undefined ? crumb.lastAnswer : clip(first.trim(), 200),
    issue: work.issue === null ? crumb.issue : { number: work.issue.number, title: work.issue.title },
    pr: work.pr === null ? crumb.pr : { number: work.pr.number, state: work.pr.state },
  })
}

/** The latest other session in the repository. */
export function previousOf(trail: Trail | null, sessionId: string): Crumb | null {
  return trail?.crumbs.find(c => c.sessionId !== sessionId) ?? null
}

/**
 * The note the model reads at the start of a conversation: the branch and
 * tree as they are now, the issue and PR as last read, and the previous
 * session's last steps. Null when there is nothing to say.
 */
export function leftOffNote(git: GitState, work: WorkView | null, previous: Crumb | null, at: number): string | null {
  if (git.root === null && previous === null) return null
  const lines = ['Where the person left off in this repository, from the desk plugin. Use it when they ask where they left off or what is next; do not recite it unprompted.']
  if (git.branch !== null) {
    const tree = [
      git.upstream === null ? 'no upstream' : `${git.ahead} ahead, ${git.behind} behind ${git.upstream}`,
      `${git.staged} staged`,
      `${git.changed} changed`,
      `${git.untracked} untracked`,
    ]
    lines.push(`Branch: ${git.branch} (${tree.join(', ')})`)
  }
  const issue = work?.issue
  if (issue != null) {
    const board = issue.columns.map(c => `${c.status} on ${c.project}`).join(', ')
    const count = criteriaCount(issue.criteria)
    lines.push(
      `Issue: #${issue.number} "${issue.title}" (${issue.state.toLowerCase()}${board === '' ? '' : `, ${board}`})` +
        (count === null ? '' : `, acceptance criteria ${count.done} of ${count.total} ticked`),
    )
    const open = issue.criteria.filter(c => !c.isDone)
    for (const c of open.slice(0, 8)) lines.push(`  [ ] ${clip(c.text, 160)}`)
    if (open.length > 8) lines.push(`  ... and ${open.length - 8} more unticked`)
  }
  const pr = work?.pr
  if (pr != null) {
    const ch = pr.checks
    const parts = [
      pr.isDraft ? 'draft' : pr.state.toLowerCase(),
      pr.review === null ? null : pr.review.toLowerCase().replace(/_/g, ' '),
      ch.failed + ch.passed + ch.running === 0 ? null : `checks ${ch.passed} passed, ${ch.failed} failed, ${ch.running} running`,
      pr.unresolved === null || pr.unresolved === 0 ? null : `${pr.unresolved} unresolved review threads`,
    ].filter(p => p !== null)
    lines.push(`PR: #${pr.number} "${pr.title}" (${parts.join(', ')})`)
  } else if (work?.repo != null && git.branch !== null) {
    lines.push('PR: none for this branch yet')
  }
  if (work?.at != null) lines.push(`(Issue and PR as read ${ago(at - work.at)} ago.)`)
  if (previous !== null) {
    lines.push(`Previous session here: ${ago(at - previous.at)} ago${previous.branch === null ? '' : `, on ${previous.branch}`}.`)
    if (previous.prompts.length > 0) {
      lines.push('Its last prompts, oldest first:')
      for (const p of previous.prompts) lines.push(`  - ${p}`)
    }
    if (previous.lastAnswer !== null) lines.push(`Claude's last answer began: ${previous.lastAnswer}`)
  }
  return lines.length === 1 ? null : lines.join('\n')
}
