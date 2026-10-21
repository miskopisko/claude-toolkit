/** The working tree the session runs in, as git reports it. */
export type GitState = {
  /** The repository's top level, or null outside a git repository. */
  root: string | null
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  changed: number
  untracked: number
}

export type Criterion = { text: string; isDone: boolean }

export type IssueView = {
  number: number
  title: string
  state: string
  url: string
  /** The issue's place on each GitHub project board it is on. */
  columns: { project: string; status: string }[]
  criteria: Criterion[]
  /** `acceptance`: the checkboxes under an acceptance-criteria heading; `all`: every checkbox in the body; `none`: no checkboxes. */
  criteriaSource: 'acceptance' | 'all' | 'none'
}

export type CheckSummary = {
  passed: number
  failed: number
  running: number
  skipped: number
  /** Names of the checks that failed. */
  failing: string[]
}

export type PrView = {
  number: number
  title: string
  state: string
  isDraft: boolean
  url: string
  /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or null where no review is asked for. */
  review: string | null
  checks: CheckSummary
  /** Review threads not yet resolved, or null when they could not be read. */
  unresolved: number | null
}

/** What GitHub says about the branch: its PR and the issue it works on. */
export type WorkView = {
  /** When this was last read, or null before the first read. */
  at: number | null
  /** `owner/name` of the GitHub repository. */
  repo: string | null
  /** The issue number the branch names, or the PR closes. */
  issueNumber: number | null
  issue: IssueView | null
  pr: PrView | null
  /** Why GitHub could not be read (no gh, not signed in, not a GitHub repository). */
  problem: string | null
  isLoading: boolean
}

export type ServiceState = 'up' | 'down' | 'starting' | 'stopping' | 'unknown'

export type ServiceView = {
  name: string
  state: ServiceState
  /** The process group desk started it in, or null when desk did not start it. */
  pid: number | null
  /** How it is checked, as the pane shows it (`:5432`, a URL, `command`). */
  probe: string
  canStart: boolean
  canStop: boolean
}

export type StackView = {
  /** The config files read, relative to the repository. */
  files: string[]
  /** Whether the person has trusted these config files' commands. */
  isTrusted: boolean
  services: ServiceView[]
  /** Why the config could not be read. */
  problem: string | null
}

/** One session's last steps in a repository. */
export type Crumb = {
  sessionId: string
  at: number
  branch: string | null
  /** The session's last prompts, oldest first. */
  prompts: string[]
  /** The first line of Claude's last answer. */
  lastAnswer: string | null
  issue: { number: number; title: string } | null
  pr: { number: number; state: string } | null
}

/** A repository's trail: the last few sessions' crumbs, the latest first. */
export type Trail = { crumbs: Crumb[] }

declare module 'claude-code' {
  interface PluginState {
    desk: {
      git: GitState
      work: WorkView
      stack: StackView
      /** The session before this one in the repository, for the pane. */
      previous: Crumb | null
      now: number
      /** The session id the where-you-left-off note was last sent in. */
      notedSession: string | null
      /** Whether the pane lists every criterion rather than the first few. */
      criteriaOpen: boolean
    }
  }
}
