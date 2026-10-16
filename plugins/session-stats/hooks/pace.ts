import type { Sample } from '../types'

const HOUR = 60 * 60 * 1000
/** How far back a pace is measured. */
export const HORIZON_MS = HOUR
/** Less history than this gives no pace: a few minutes' spend says little about the next hour. */
const MIN_SPAN_MS = 5 * 60 * 1000

/**
 * Adds a reading, keeping the ones inside the horizon plus the newest one
 * before it, the baseline a pace is measured from. A reading lower than the
 * last (a usage limit that reset) starts the series over.
 */
export function addSample(samples: Sample[], at: number, value: number): Sample[] {
  const last = samples[samples.length - 1]
  if (last !== undefined && value < last.value) return [{ at, value }]
  // A flat run keeps its first and last readings: the ones between change no pace.
  const before = samples[samples.length - 2]
  const kept = before !== undefined && last !== undefined && before.value === value && last.value === value ? samples.slice(0, -1) : samples
  const all = [...kept, { at, value }]
  const cut = at - HORIZON_MS
  let first = 0
  while (first + 1 < all.length && (all[first + 1] as Sample).at <= cut) first += 1
  return all.slice(first)
}

/**
 * Growth per hour over the last hour up to `now`. Idle time counts, so a break
 * slows the pace; null with under five minutes of history.
 */
export function perHour(samples: Sample[], now: number): number | null {
  const latest = samples[samples.length - 1]
  if (latest === undefined) return null
  const cut = now - HORIZON_MS
  let base = samples[0] as Sample
  for (const s of samples) if (s.at <= cut) base = s
  const span = now - base.at
  if (span < MIN_SPAN_MS) return null
  return ((latest.value - base.value) / span) * HOUR
}

export type Forecast = { kind: 'full'; inMs: number } | { kind: 'at-reset'; percent: number }

/**
 * Where a usage limit lands at `ratePerHour`: full before it resets (and when),
 * or the share used when it resets. Null with no pace, or no pace and no reset.
 */
export function forecast(percentUsed: number, ratePerHour: number | null, resetsInMs: number | null): Forecast | null {
  if (percentUsed >= 100) return { kind: 'full', inMs: 0 }
  if (ratePerHour === null) return null
  if (ratePerHour <= 0) return resetsInMs === null ? null : { kind: 'at-reset', percent: percentUsed }
  const inMs = ((100 - percentUsed) / ratePerHour) * HOUR
  if (resetsInMs === null || inMs < resetsInMs) return { kind: 'full', inMs }
  return { kind: 'at-reset', percent: percentUsed + (ratePerHour * resetsInMs) / HOUR }
}

/**
 * What the prompt cache saved on one response, in dollars, at `price` ($ per
 * million tokens: [cache read, 1h cache write, output]). Reads are saved
 * against the base input rate, half the 1h write rate; writes cost a premium
 * over it, priced at the 1h rate.
 */
export function cacheSavings(
  u: { cache_read_input_tokens: number; cache_creation_input_tokens: number },
  price: [number, number, number],
): { readsUsd: number; premiumUsd: number } {
  const [read, write] = price
  const base = write / 2
  return {
    readsUsd: (u.cache_read_input_tokens * (base - read)) / 1e6,
    premiumUsd: (u.cache_creation_input_tokens * (write - base)) / 1e6,
  }
}
