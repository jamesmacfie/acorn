import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../../../shared/api'
import { DEFAULT_SELECTION, selectionToInclude, traySummary } from './model'

describe('selectionToInclude', () => {
  it('maps checked slices to the include param', () => {
    expect(selectionToInclude(DEFAULT_SELECTION)).toEqual(['pr', 'issues', 'notes'])
    expect(selectionToInclude({ pr: false, issues: true, notes: false, memory: true })).toEqual(['issues', 'memory'])
    expect(selectionToInclude({ pr: false, issues: false, notes: false, memory: false })).toEqual([])
  })
})

describe('traySummary', () => {
  const ctx: TaskContext = {
    task: { id: 't', title: 'x', repo: 'a/b', branch: 'm', worktreePath: null, pullNumber: 813 },
    pr: { number: 813, title: 'x', body: null, changedFiles: [] },
    issues: [
      { provider: 'rollbar', identifier: '142', title: 'boom', detail: '' },
      { provider: 'linear', identifier: 'ENG-42', title: 'fix', detail: '' },
    ],
    notes: [{ title: 'plan', body: 'p' }],
    memory: [],
  }
  it('counts PR + issues as sources, plus notes/memories when present', () => {
    expect(traySummary(ctx)).toBe('3 sources · 1 note')
    expect(traySummary({ ...ctx, pr: undefined, issues: [], notes: [], memory: [{ name: 'n', description: 'd' }] })).toBe('0 sources · 1 memory')
    expect(traySummary(undefined)).toBe('context')
  })
})
