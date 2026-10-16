export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
}

export type LastRequest = {
  model: string
  at: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type Tokens = {
  main: Usage
  agents: Usage
  /** The last main-loop request: what the prompt cache holds now. */
  last: LastRequest | null
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  startedAt: number | null
  model: string | null
  effort: string | null
  contextTokens: number | null
  contextWindow: number | null
  contextPercent: number | null
  rateLimits: Limit[]
  costUsd: number | null
  version: string | null
}

export type TurnInfo = {
  count: number
  runningSince: number | null
  lastMs: number | null
  steps: number
  compactions: number
}

export type RunningTool = { id: string; tool: string; since: number; agentId?: string }

export type ToolStats = {
  counts: Record<string, number>
  errors: number
  running: RunningTool[]
}

export type AgentRow = {
  id: string
  description: string
  type: string
  status: string
  firstSeen: number
  lastSeen: number
  tokens: number
  tools: number
  lastTool: string | null
}

/** The cache-tax part of the pane: its one-hour clock, prices, keepwarm window and tally. */
export type CacheTaxView = {
  lastRequestAt: number
  /** When the one-hour cache lapses (or lapsed); null before the first request or after compaction. */
  expiresAt: number | null
  ctx: number
  coldUsd: number | null
  warmUsd: number | null
  /** The keepwarm window's end; null while keepwarm is off. */
  deadline: number | null
  nextPingAt: number | null
  stopped: string | null
  lastPing: { at: number; read: number; usd: number | null } | null
  guard: 'refuse' | 'warn'
  always: boolean
  coldWrites: number
  paidUsd: number
}

/** One reading of a running total (cost in dollars, a limit's percent used) at a time. */
export type Sample = { at: number; value: number }

/** The last hour or so of readings each pace is measured over. */
export type Pace = {
  cost: Sample[]
  /** Keyed by the limit's `kind`. */
  limits: Record<string, Sample[]>
}

/** What the prompt cache saved this session, main loop and agents, in dollars. */
export type Savings = {
  readsUsd: number
  /** Cache writes' cost over the base input rate, priced at the 1-hour write rate. */
  premiumUsd: number
  /** Responses on a model with no price, left out of both figures. */
  unpriced: number
}

/** The switches the pane's buttons and /session-stats toggle; each is remembered across sessions. */
export type Settings = {
  alerts: boolean
  /** A desktop notification when a long turn finishes. */
  notify: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-stats': {
      snap: Snapshot
      tokens: Tokens
      turn: TurnInfo
      tools: ToolStats
      agents: AgentRow[]
      now: number
      cacheTax: CacheTaxView | null
      pace: Pace
      savings: Savings
      settings: Settings
    }
  }
}
