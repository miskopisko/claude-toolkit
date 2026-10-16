import type { EngineInterface } from 'claude-code'

import type { GitState } from '../types'

export const NO_GIT: GitState = {
  root: null,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  changed: 0,
  untracked: 0,
}

/**
 * The default way a branch names its issue: a number standing alone between
 * separators, as in `implement/284-conflict-alert`, `feature/12_login`, `gh-7`
 * or `123`. A version such as `bump-1.2.3` names none.
 */
export const ISSUE_PATTERN = '(?:^|[/_#-])(\\d+)(?=[/_-]|$)'

/** The issue number a branch name carries, by the pattern's first group. */
export function issueFromBranch(branch: string | null, pattern = ISSUE_PATTERN): number | null {
  if (branch === null) return null
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch {
    return null
  }
  const found = re.exec(branch)?.[1]
  const n = found === undefined ? NaN : Number(found)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Reads `git status --porcelain=v2 --branch` into counts. */
export function parseStatus(text: string): Omit<GitState, 'root'> {
  const { root: _root, ...state } = NO_GIT
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      state.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      state.upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice('# branch.ab '.length).split(' ')
      state.ahead = Math.abs(Number(ahead) || 0)
      state.behind = Math.abs(Number(behind) || 0)
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') state.staged += 1
      if (xy[1] !== '.') state.changed += 1
    } else if (line.startsWith('? ')) {
      state.untracked += 1
    }
  }
  return state
}

/** The working tree at `cwd`; outside a repository, or without git, all empty. */
export async function readGit($: EngineInterface, cwd: string): Promise<GitState> {
  try {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5000 })
    if (top.exitCode !== 0) return NO_GIT
    const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 10_000 })
    if (status.exitCode !== 0) return { ...NO_GIT, root: top.stdout.trim() }
    return { root: top.stdout.trim(), ...parseStatus(status.stdout) }
  } catch {
    return NO_GIT
  }
}

/** The repository's git directory (where desk keeps service logs), or null. */
export async function gitDir($: EngineInterface, cwd: string): Promise<string | null> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--absolute-git-dir'], { cwd, timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}
