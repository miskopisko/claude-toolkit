import type { Pace, Snapshot } from '../types'
import { duration, limitName, tokens as tok, usd } from './format'
import { forecast, perHour } from './pace'

/** Context fill that warns, and the fill it must drop under (a compaction) to warn again. */
export const CONTEXT_ALERT = 80
const CONTEXT_REARM = 70
/** A usage limit this full warns, once per window. */
export const LIMIT_ALERT = 90
/** A forecast that runs a limit out within this long, before it resets, warns; at twice it re-arms. */
export const FORECAST_ALERT_MS = 60 * 60 * 1000
/** A main turn that costs this much warns. */
export const TURN_ALERT_USD = 5

export type Alerts = {
  context: boolean
  limits: Set<string>
  forecasts: Set<string>
  /** The session's cost when the running main turn started. */
  turnStartUsd: number | null
}

export const freshAlerts = (): Alerts => ({
  context: false,
  limits: new Set(),
  forecasts: new Set(),
  turnStartUsd: null,
})

/** The lines to log for what crossed a threshold since the last check; each warns once until it re-arms. */
export function checkAlerts(a: Alerts, s: Snapshot, pace: Pace, now: number): string[] {
  const lines: string[] = []

  const ctx = s.contextPercent
  if (ctx !== null) {
    if (ctx >= CONTEXT_ALERT && !a.context) {
      a.context = true
      lines.push(
        `context is ${ctx}% full (${tok(s.contextTokens ?? 0)} of ${tok(s.contextWindow ?? 0)}). ` +
          'Compaction is coming; /compact at a natural break keeps the timing yours.',
      )
    } else if (ctx < CONTEXT_REARM) a.context = false
  }

  for (const r of s.rateLimits) {
    const name = limitName(r.kind)
    const resetsAt = r.resetsAt === undefined ? NaN : Date.parse(r.resetsAt)
    const resetsIn = Number.isNaN(resetsAt) ? null : Math.max(0, resetsAt - now)
    const resetText = resetsIn === null ? '' : `, resets in ${duration(resetsIn)}`

    if (r.percentUsed >= LIMIT_ALERT) {
      if (!a.limits.has(r.kind)) {
        a.limits.add(r.kind)
        lines.push(`the ${name} limit is ${r.percentUsed}% used${resetText}.`)
      }
      continue
    }
    a.limits.delete(r.kind)

    const f = forecast(r.percentUsed, perHour(pace.limits[r.kind] ?? [], now), resetsIn)
    const isSoon = f !== null && f.kind === 'full' && f.inMs < FORECAST_ALERT_MS
    if (isSoon && !a.forecasts.has(r.kind)) {
      a.forecasts.add(r.kind)
      const early = resetsIn === null ? '' : `, ${duration(resetsIn - f.inMs)} before it resets`
      lines.push(`at this pace the ${name} limit runs out in ${duration(f.inMs)}${early}.`)
    } else if (f === null || f.kind !== 'full' || f.inMs >= 2 * FORECAST_ALERT_MS) a.forecasts.delete(r.kind)
  }

  return lines
}

/** The line for a main turn that cost `TURN_ALERT_USD` or more, if this one did. */
export function turnCostAlert(a: Alerts, costUsd: number | null): string | null {
  const start = a.turnStartUsd
  a.turnStartUsd = null
  if (start === null || costUsd === null) return null
  const spent = costUsd - start
  return spent >= TURN_ALERT_USD ? `that turn cost ${usd(spent)} (session ${usd(costUsd)}).` : null
}
