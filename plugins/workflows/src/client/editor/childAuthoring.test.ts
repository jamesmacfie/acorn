import { describe, expect, it } from 'vitest'
import { childWorkflowDefinition, connectCreatedChild } from './childAuthoring'

describe('in-context child authoring', () => {
  it('declares and binds the typed current record', () => {
    const schema = { type: 'object' as const, properties: { id: { type: 'string' as const } }, required: ['id'] }
    expect(childWorkflowDefinition('Triage', schema).inputs).toEqual([expect.objectContaining({ name: 'record', schema, required: true })])
    expect(connectCreatedChild({ id: 'map', name: 'For each', kind: 'workflow-map' }, 'child')).toEqual({
      childWorkflow: { ref: { source: 'database', id: 'child' }, inputs: { record: { address: { from: 'item', pointer: '' } } } },
    })
  })
})
