import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../../../core/shared/api'
import { assembleBlockFrom, bytesOf, formatSize, sectionCap, selectionFromContext, traySummary } from './model'

const ctx: TaskContext = {
  task: { id: 't', title: 'x', repo: 'a/b', branch: 'm', worktreePath: null, pullNumber: null },
  sections: [
    { id: 'notes', label: 'Notes', defaultIncluded: true, budget: { maxItems: 10, maxBytesPerItem: 2_000, overflow: 'truncate-tail' }, items: [{ id: 'n', kind: 'note', label: 'Plan' }], compact: '## Notes\n### Plan\nbody', omitted: 0 },
    { id: 'memory', label: 'Memory', defaultIncluded: false, budget: { maxItems: 30, overflow: 'index-only' }, items: [], compact: '## Repo memory', omitted: 0, absent: { reason: 'missing-cache', detail: 'missing' } },
  ],
  issues: [],
  notes: [],
  memory: [],
}

describe('context tray model', () => {
  it('derives selection defaults from section contributions', () => {
    expect(selectionFromContext(ctx)).toEqual({ notes: true, memory: false })
  })

  it('summarizes serialized sections without knowing their ids', () => {
    expect(traySummary(ctx)).toBe('2 sections · 1 item · 1 incomplete')
    expect(traySummary(undefined)).toBe('context')
  })

  it('sizes bytes with a token estimate above 1 KB', () => {
    expect(bytesOf('abc')).toBe(3)
    expect(bytesOf('é')).toBe(2)
    expect(formatSize(412)).toBe('412 B')
    expect(formatSize(2_100)).toBe('2.1 KB · ~525 tok')
  })

  it('caps by maxItems × maxBytesPerItem, null when index-only', () => {
    expect(sectionCap(ctx.sections[0].budget)).toBe(20_000)
    expect(sectionCap(ctx.sections[1].budget)).toBeNull()
  })

  it('assembles the block from selected sections only, in order', () => {
    const all = assembleBlockFrom(ctx, { notes: true, memory: true })
    expect(all.block).toBe('# Task: x (a/b · m)\n\n## Notes\n### Plan\nbody\n\n## Repo memory')
    expect(all.sections).toEqual({ notes: '## Notes\n### Plan\nbody', memory: '## Repo memory' })

    const notesOnly = assembleBlockFrom(ctx, { notes: true, memory: false })
    expect(notesOnly.block).toBe('# Task: x (a/b · m)\n\n## Notes\n### Plan\nbody')
    expect(notesOnly.sections).toEqual({ notes: '## Notes\n### Plan\nbody' })
  })
})
