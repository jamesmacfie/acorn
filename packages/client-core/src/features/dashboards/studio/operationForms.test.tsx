import { describe, expect, it } from 'vitest'
import { PANEL_CAPABILITIES } from '@acorn/dashboards-core/capabilities.ts'
import { availableOperations, planOutline } from '@acorn/dashboards-core/outline.ts'
import { formPlan } from '../../../testkit/stageForms'
import { addStageTo } from './inspectors'
import { operationForms } from './operationForms'

// Every operation needs a form, an outline title, and an Add menu entry. The fourth part, an
// evaluation case, is checked in dashboards-core's authoringEvaluation.test.ts.
describe('operation registry', () => {
  const base = formPlan({ op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/title' } }, operator: 'present' } })
  it.each(PANEL_CAPABILITIES.operations.map(operation => operation.id))('%s has a form, an outline title, and an Add entry', op => {
    expect(operationForms[op]).toBeTypeOf('function')
    expect(availableOperations(base).some(entry => entry.id === op)).toBe(true)
    const added = addStageTo({ ...base, stages: [] }, op)
    expect(added.stages.map(stage => stage.op)).toEqual([op])
    expect(planOutline(added).find(part => part.key === 'stage:0')?.title).toMatch(/\S/)
  })
})
