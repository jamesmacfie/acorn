import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../../../core/shared/api'
import { selectionFromContext, selectionToInclude, traySummary } from './model'

const ctx: TaskContext = {
  task: { id: 't', title: 'x', repo: 'a/b', branch: 'm', worktreePath: null, pullNumber: null },
  sections: [
    { id: 'notes', label: 'Notes', defaultIncluded: true, budget: { overflow: 'truncate-tail' }, items: [{ id: 'n', kind: 'note', label: 'Plan' }], compact: '', omitted: 0 },
    { id: 'memory', label: 'Memory', defaultIncluded: false, budget: { overflow: 'index-only' }, items: [], compact: '', omitted: 0, absent: { reason: 'missing-cache', detail: 'missing' } },
  ],
  issues: [],
  notes: [],
  memory: [],
}

describe('context tray model', () => {
  it('derives selection defaults from section contributions', () => {
    expect(selectionFromContext(ctx)).toEqual({ notes: true, memory: false })
    expect(selectionToInclude({ notes: true, memory: false, ci: true })).toEqual(['notes', 'ci'])
  })

  it('summarizes serialized sections without knowing their ids', () => {
    expect(traySummary(ctx)).toBe('2 sections · 1 item · 1 incomplete')
    expect(traySummary(undefined)).toBe('context')
  })
})
