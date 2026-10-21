import { describe, expect, test } from 'claude-code/testing'

import { issueFromBranch, parseStatus } from '../hooks/git'
import { closingIssue, parseCriteria, summarizeChecks } from '../hooks/github'
import { fingerprint, hasCommands, mergeConfigs, parseConfig, stateOf } from '../hooks/stack'
import { asTrail, leftOffNote, previousOf, withAnswer, withPrompt } from '../hooks/trail'

describe('branches', () => {
  test('a branch names its issue by a number standing alone', () => {
    expect(issueFromBranch('implement/284-recalculation-override-conflict')).toBe(284)
    expect(issueFromBranch('feature/12_login')).toBe(12)
    expect(issueFromBranch('gh-7')).toBe(7)
    expect(issueFromBranch('123')).toBe(123)
    expect(issueFromBranch('fix/#45')).toBe(45)
    expect(issueFromBranch('chore/bump-1.2.3')).toBe(null)
    expect(issueFromBranch('main')).toBe(null)
    expect(issueFromBranch(null)).toBe(null)
  })

  test('a pattern of the team’s own wins', () => {
    expect(issueFromBranch('PROJ-88-thing', '^PROJ-(\\d+)')).toBe(88)
    expect(issueFromBranch('anything', '(')).toBe(null)
  })

  test('git status counts staged, changed and new files and the upstream gap', () => {
    const s = parseStatus(
      [
        '# branch.oid abc',
        '# branch.head implement/284-x',
        '# branch.upstream origin/implement/284-x',
        '# branch.ab +2 -1',
        '1 M. N... 100644 100644 100644 a b src/a.ts',
        '1 .M N... 100644 100644 100644 a b src/b.ts',
        '1 MM N... 100644 100644 100644 a b src/c.ts',
        '? notes.txt',
      ].join('\n'),
    )
    expect(s).toEqual({
      branch: 'implement/284-x',
      upstream: 'origin/implement/284-x',
      ahead: 2,
      behind: 1,
      staged: 2,
      changed: 2,
      untracked: 1,
    })
  })
})

describe('issues and PRs', () => {
  const body = [
    '## What to build',
    '- [x] not a criterion',
    '## Acceptance criteria',
    '- [ ] An alert shows **all three** values.',
    '- [x] The override stays in force.',
    '  * [X] Nested, and [linked](https://x.y) text',
    '### Notes under it',
    '- [ ] still under acceptance',
    '## Out of scope',
    '- [ ] not this one',
  ].join('\n')

  test('criteria are the boxes under the acceptance heading', () => {
    const { criteria, source } = parseCriteria(body)
    expect(source).toBe('acceptance')
    expect(criteria).toEqual([
      { text: 'An alert shows all three values.', isDone: false },
      { text: 'The override stays in force.', isDone: true },
      { text: 'Nested, and linked text', isDone: true },
      { text: 'still under acceptance', isDone: false },
    ])
  })

  test('with no acceptance heading, every box counts', () => {
    expect(parseCriteria('- [ ] one\n- [x] two').source).toBe('all')
    expect(parseCriteria('no boxes').source).toBe('none')
  })

  test('checks are counted across check runs and commit statuses', () => {
    const sum = summarizeChecks([
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'e2e', status: 'IN_PROGRESS', conclusion: '' },
      { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { context: 'ci/legacy', state: 'ERROR' },
      { context: 'deploy', state: 'SUCCESS' },
    ])
    expect(sum).toEqual({ passed: 2, failed: 2, running: 1, skipped: 1, failing: ['lint', 'ci/legacy'] })
  })

  test('the issue a PR closes is one in this repository', () => {
    const repo = { owner: 'o', name: 'r' }
    const elsewhere = { number: 12, repository: { name: 'other', owner: { login: 'o' } } }
    const here = { number: 7, repository: { name: 'R', owner: { login: 'O' } } }
    expect(closingIssue([elsewhere, here], repo)).toBe(7)
    expect(closingIssue([elsewhere], repo)).toBe(null)
    expect(closingIssue([{ number: 3 }], repo)).toBe(3)
    expect(closingIssue(null, repo)).toBe(null)
  })
})

describe('the stack config', () => {
  test('a config reads, and problems name the file and the field', () => {
    const ok = parseConfig(
      JSON.stringify({ services: [{ name: 'DB', check: { port: 5432 }, start: 'docker start db' }, { name: 'Web', check: { http: 'http://localhost:3000' } }] }),
      '.claude/desk.json',
    )
    expect('config' in ok && ok.config.services.length).toBe(2)
    const bad = parseConfig(JSON.stringify({ services: [{ name: 'DB', check: { port: 99999 } }] }), '.claude/desk.json')
    expect('problem' in bad && bad.problem).toBe('.claude/desk.json services[0]: "port" must be 1 to 65535')
    expect('problem' in parseConfig('{', 'x.json')).toBe(true)
  })

  test("the person's file replaces a same-named service and adds new ones", () => {
    const merged = mergeConfigs(
      { services: [{ name: 'DB', start: 'a' }, { name: 'API', start: 'b' }] },
      { issuePattern: 'X-(\\d+)', services: [{ name: 'API', start: 'mine' }, { name: 'Mock', start: 'c' }] },
    )
    expect(merged.services.map(s => `${s.name}=${s.start}`)).toEqual(['DB=a', 'API=mine', 'Mock=c'])
    expect(merged.issuePattern).toBe('X-(\\d+)')
  })

  test('trust is asked only for commands, and lapses when the text changes', () => {
    expect(hasCommands({ services: [{ name: 'DB', check: { port: 1 } }] })).toBe(false)
    expect(hasCommands({ services: [{ name: 'DB', start: 'x' }] })).toBe(true)
    expect(fingerprint('a')).not.toBe(fingerprint('b'))
  })

  test('a service reads starting until it answers, then up', () => {
    expect(stateOf('down', { action: 'start', since: 0 }, 5000)).toBe('starting')
    expect(stateOf('up', { action: 'start', since: 0 }, 5000)).toBe('up')
    expect(stateOf('down', { action: 'start', since: 0 }, 200_000)).toBe('down')
    expect(stateOf('up', { action: 'stop', since: 0 }, 1000)).toBe('stopping')
  })
})

describe('the trail', () => {
  const work = { at: 0, repo: 'o/r', issueNumber: 7, issue: null, pr: null, problem: null, isLoading: false }

  test('a new session moves the last one to previous', () => {
    let t = withPrompt(null, 's1', 1000, 'start #7', 'b7')
    t = withAnswer(t, 's1', 2000, 'Done.\nMore lines', 'b7', work)
    expect(previousOf(t, 's2')?.lastAnswer).toBe('Done.')
    t = withPrompt(t, 's2', 3000, 'where did I leave off?', 'b7')
    expect(t.crumbs.map(c => c.sessionId)).toEqual(['s2', 's1'])
    expect(previousOf(t, 's2')?.prompts).toEqual(['start #7'])
  })

  test('two sessions open at once each keep their own prompts', () => {
    let t = withPrompt(null, 'a', 1, 'a1', 'b')
    t = withPrompt(t, 'b', 2, 'b1', 'b')
    t = withPrompt(t, 'a', 3, 'a2', 'b')
    t = withPrompt(t, 'b', 4, 'b2', 'b')
    expect(previousOf(t, 'b')?.prompts).toEqual(['a1', 'a2'])
    expect(previousOf(t, 'a')?.prompts).toEqual(['b1', 'b2'])
    expect(previousOf(t, 'c')?.sessionId).toBe('b')
  })

  test('a trail kept by an earlier desk still reads', () => {
    const crumb = { sessionId: 's1', at: 0, branch: null, prompts: ['old'], lastAnswer: null, issue: null, pr: null }
    expect(previousOf(asTrail({ current: crumb, previous: null }), 's2')?.prompts).toEqual(['old'])
    expect(asTrail(undefined)).toBe(null)
  })

  test('only the last five prompts are kept', () => {
    let t = null as ReturnType<typeof withPrompt> | null
    for (let i = 1; i <= 7; i++) t = withPrompt(t, 's', i, `p${i}`, null)
    expect(t?.crumbs[0]?.prompts).toEqual(['p3', 'p4', 'p5', 'p6', 'p7'])
  })

  test('the note says the branch, the open criteria and the last session', () => {
    const git = { root: '/r', branch: 'b7', upstream: 'origin/b7', ahead: 1, behind: 0, staged: 2, changed: 0, untracked: 0 }
    const issue = {
      number: 7,
      title: 'Seven',
      state: 'OPEN',
      url: 'u',
      columns: [{ project: 'Board', status: 'In progress' }],
      criteria: [
        { text: 'done one', isDone: true },
        { text: 'open one', isDone: false },
      ],
      criteriaSource: 'acceptance' as const,
    }
    const prev = { sessionId: 's1', at: 0, branch: 'b7', prompts: ['commit and push'], lastAnswer: 'Pushed.', issue: null, pr: null }
    const note = leftOffNote(git, { ...work, issue }, prev, 3_600_000)!
    expect(note).toContain('Branch: b7 (1 ahead, 0 behind origin/b7, 2 staged')
    expect(note).toContain('Issue: #7 "Seven" (open, In progress on Board), acceptance criteria 1 of 2 ticked')
    expect(note).toContain('  [ ] open one')
    expect(note).not.toContain('done one')
    expect(note).toContain('PR: none for this branch yet')
    expect(note).toContain('Previous session here: 1h ago, on b7.')
    expect(note).toContain('  - commit and push')
    expect(leftOffNote({ ...git, root: null, branch: null }, null, null, 0)).toBe(null)
  })
})
