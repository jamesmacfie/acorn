import { describe, expect, it } from 'vitest'
import { mergeAuthoringCandidate } from './authoringMerge'

describe('mergeAuthoringCandidate', () => {
  it('rebases non-overlapping edits and aligns identified query entries', () => {
    const base = { title: 'Panel', queries: [{ id: 'a', label: 'A', value: 1 }, { id: 'b', label: 'B', value: 2 }] }
    const proposal = { title: 'AI panel', queries: [{ id: 'a', label: 'A', value: 1 }, { id: 'b', label: 'B', value: 3 }] }
    const current = { title: 'Panel', queries: [{ id: 'b', label: 'Renamed', value: 2 }, { id: 'a', label: 'A', value: 1 }] }
    const merged = mergeAuthoringCandidate(base, proposal, current)
    expect(merged.conflicts).toEqual([])
    expect(merged.value.title).toBe('AI panel')
    expect(merged.value.queries.find(query => query.id === 'b')).toEqual({ id: 'b', label: 'Renamed', value: 3 })
  })

  it('keeps the newer draft and reports a same-field conflict', () => {
    const merged = mergeAuthoringCandidate({ title: 'Base' }, { title: 'AI' }, { title: 'Person' })
    expect(merged.value.title).toBe('Person')
    expect(merged.conflicts).toEqual([{ path: '/title', base: 'Base', proposal: 'AI', current: 'Person' }])
  })
})
