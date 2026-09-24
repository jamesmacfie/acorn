import { describe, expect, it } from 'vitest'
import { mergeWorkflow } from './workflowMerge'

describe('workflow conflict reconciliation', () => {
  it('merges independent object and stable-ID changes', () => {
    const base = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'base', steps: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }
    const local = { ...base, name: 'local' }
    const external = { ...base, steps: [{ id: 'b', name: 'changed' }, { id: 'a', name: 'A' }] }
    expect(mergeWorkflow(base, local, external)).toEqual({ value: { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'local', steps: external.steps }, conflicts: [] })
  })
  it('retains delete versus edit and conflicting fields until chosen', () => {
    const base = { steps: [{ id: 'a', name: 'A' }] }
    const local = { steps: [] as typeof base.steps }
    const external = { steps: [{ id: 'a', name: 'B' }] }
    expect(mergeWorkflow(base, local, external).conflicts[0]?.path).toBe('/steps/@a')
    expect(mergeWorkflow(base, local, external, { '/steps/@a': 'external' })).toEqual({ value: external, conflicts: [] })
  })
  it('refuses concurrent reorder and treats unidentified arrays atomically', () => {
    const base = ['a', 'b', 'c'].map(id => ({ id }))
    expect(mergeWorkflow(base, [base[1], base[0], base[2]], [base[0], base[2], base[1]]).conflicts).toHaveLength(1)
    expect(mergeWorkflow([1, 2], [1, 3], [4, 2]).conflicts).toHaveLength(1)
  })
  it('keeps one-sided insertions in place and refuses competing structural edits', () => {
    const base = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]
    const local = [base[0], { ...base[1], text: 'edited' }]
    const external = [base[0], { id: 'x', text: 'X' }, base[1]]
    expect(mergeWorkflow(base, local, external).value.map(item => item.id)).toEqual(['a', 'x', 'b'])
    expect(mergeWorkflow(base, [...local, { id: 'y', text: 'Y' }], external).conflicts).toHaveLength(1)
  })
})
