import { describe, expect, it } from 'vitest'
import { addAiList } from './aiListDraft'
import { emptyDefinition, newDraft } from './draft'

describe('AI list shortcut', () => {
  it('adds a structured planning step and For each as one immutable edit', () => {
    const before = newDraft(emptyDefinition())
    const after = addAiList(before)
    const [plan, each] = after.def.steps
    expect(before.def.steps).toEqual([])
    expect(plan?.schema).toMatchObject({ properties: { items: { items: { required: ['id', 'title'] } } } })
    expect(each).toMatchObject({ kind: 'workflow-map', after: [plan!.id], items: { step: plan!.id, pointer: '/items' }, itemKey: '/id' })
    expect(each?.childWorkflow).toBeUndefined()
    expect(after.selection).toEqual({ kind: 'node', name: each!.id })
    expect(plan!.id).not.toBe(each!.id)
  })
})
