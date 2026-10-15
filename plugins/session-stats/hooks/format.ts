import type { Usage } from '../types'

export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  requests: 0,
})

/** 950 -> "950", 12_345 -> "12.3k", 1_250_000 -> "1.25M". */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1).replace(/\.?0+$/, '')}k`
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
}

/** 45_000 -> "45s", 192_000 -> "3m12s", 8_040_000 -> "2h14m", 2 days -> "2d3h". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

/** A bar `width` cells wide, filled to `percent` (clamped to 0-100). */
export function bar(percent: number, width: number): string {
  const w = Math.max(1, width)
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * w)
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

/** The theme colour for how full something is: green, then amber past 70, red past 90. */
export function levelColor(percent: number): 'success' | 'warning' | 'error' {
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'
  return 'success'
}

/** Share of the input the prompt cache served: read over all input, 0-100; null with no input. */
export function hitRate(u: { input: number; cacheRead: number; cacheWrite: number }): number | null {
  const all = u.input + u.cacheRead + u.cacheWrite
  return all === 0 ? null : Math.round((u.cacheRead / all) * 100)
}

export function addUsage(
  into: Usage,
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
): Usage {
  return {
    input: into.input + u.input_tokens,
    output: into.output + u.output_tokens,
    cacheRead: into.cacheRead + u.cache_read_input_tokens,
    cacheWrite: into.cacheWrite + u.cache_creation_input_tokens,
    requests: into.requests + 1,
  }
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: '7-day',
  seven_day_opus: '7-day Opus',
  seven_day_sonnet: '7-day Sonnet',
  spend_limit: 'Spend',
}

export const limitName = (kind: string): string => LIMIT_NAMES[kind] ?? kind.replace(/_/g, ' ')

export const usd = (n: number): string => `$${n.toFixed(2)}`
