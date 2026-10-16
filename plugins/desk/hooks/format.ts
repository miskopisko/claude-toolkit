import type { Criterion } from '../types'

/** A span of time as a person says it: `40s`, `12m`, `3h`, `2d`. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** Text cut to `n` characters, an ellipsis marking the cut. */
export function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, Math.max(0, n - 1))}…`
}

/** A bar of `width` cells, `done` of `total` filled. */
export function bar(done: number, total: number, width: number): string {
  const filled = total <= 0 ? 0 : Math.round((Math.min(done, total) / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function criteriaCount(criteria: readonly Criterion[]): { done: number; total: number } | null {
  if (criteria.length === 0) return null
  return { done: criteria.filter(c => c.isDone).length, total: criteria.length }
}

/** A review decision in the pane's words. */
export function reviewWords(review: string | null): string {
  switch (review) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes requested'
    case 'REVIEW_REQUIRED':
      return 'review required'
    default:
      return 'no review asked'
  }
}
