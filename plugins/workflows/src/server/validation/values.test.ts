import { describe, expect, it } from 'vitest'
import { MISSING } from '@acorn/protocol/dataValues.ts'
import { readDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import type { WorkflowDef, WorkflowStepRow } from '../../shared/workflowContracts'
import { resolveWorkflowInputs, workflowEdges } from './definition'
import { predecessorValues, workflowOutputs, workflowValueProblems, workflowText } from './values'
import { resolveChildWorkflowInputs, resolveWorkflowMapRoster } from './bindings'
import { parseWorkflowToml } from '../definitions/files'
import { writeWorkflowToml } from '../definitions/toml'
import { renameNode, newDraft, graphOrder } from '../../client/editor/draft'

const def: WorkflowDef = {
  baseline: 'acorn-1' as const,
  formatVersion: 1 as const, name: 'Typed workflow',
  inputs: [
    { name: 'record', schema: { type: 'object' }, required: true, default: { nested: [null, { done: false }], number: 7 } },
    { name: 'count', schema: { type: 'number' }, default: 0 },
    { name: 'enabled', schema: { type: 'boolean' }, default: false },
    { name: 'optional', schema: { type: 'string' } },
    { name: 'nullable', schema: { type: ['string', 'null'] }, required: true, default: null },
  ],
  outputs: [{ name: 'record', schema: { type: 'object' }, binding: { address: { from: 'step', stepId: 'first', pointer: '' } } }],
  steps: [
    { id: 'first', name: 'A readable label', after: [], schema: { type: 'object' } },
    { id: 'sibling', name: 'A readable label', after: [], schema: { type: 'object' } },
    { id: 'last', name: 'Final step', after: ['first'] },
  ],
}
const rows = [
  { idx: 0, name: 'A readable label', status: 'done', structuredJson: '{"number":7,"enabled":false,"nested":[null]}' },
  { idx: 1, name: 'A readable label', status: 'done', structuredJson: '{"secret":true}' },
] as WorkflowStepRow[]

describe('v2 workflow values', () => {
  it('round trips nested null defaults, output bindings and stable identities through TOML', () => {
    const errors: { source: string; message: string }[] = []
    const parsed = parseWorkflowToml(writeWorkflowToml(def), 'test', 'repo', errors)
    expect(errors).toEqual([])
    expect(parsed).toMatchObject(def)
    expect(workflowValueProblems(parsed!)).toEqual([])
  })

  it('preserves defaults, absence and explicit null without inferred conversion', () => {
    expect(resolveWorkflowInputs(def, undefined)).toEqual({ record: def.inputs![0].default, count: 0, enabled: false, nullable: null })
    expect(() => resolveWorkflowInputs(def, { count: '12px' })).toThrow('number')
    expect(() => resolveWorkflowInputs(def, { count: null })).toThrow('number')
    expect(() => resolveWorkflowInputs({ ...def, inputs: [{ name: 'required', required: true, schema: { type: 'number' } }] }, {})).toThrow('needs a value')
    expect(resolveWorkflowInputs(def, { nullable: null }).nullable).toBeNull()
  })

  it('passes whole records, numbers and booleans from completed transitive predecessors only', () => {
    const admitted = predecessorValues(def, def.steps[2], rows)
    expect(Object.keys(admitted)).toEqual(['first'])
    expect(resolveChildWorkflowInputs({
      record: { address: { from: 'step', stepId: 'first', pointer: '' } },
      count: { address: { from: 'step', stepId: 'first', pointer: '/number' } },
      enabled: { address: { from: 'step', stepId: 'first', pointer: '/enabled' } },
      fallback: { address: { from: 'step', stepId: 'first', pointer: '/missing' }, fallback: null },
      optional: { address: { from: 'step', stepId: 'first', pointer: '/missing' } },
    }, {}, rows, admitted)).toEqual({ record: { number: 7, enabled: false, nested: [null] }, count: 7, enabled: false, fallback: null })
    expect(readDataBinding({ address: { from: 'step', stepId: 'sibling', pointer: '' } }, { steps: admitted })).toBe(MISSING)
    expect(workflowOutputs(def, rows)).toEqual({ record: { number: 7, enabled: false, nested: [null] } })
  })

  it('converts only explicitly and renders deterministic JSON only at the text boundary', () => {
    expect(readDataBinding({ address: { from: 'literal', value: false }, conversion: 'scalar-to-text' }, {})).toBe('false')
    expect(() => readDataBinding({ address: { from: 'literal', value: {} }, conversion: 'scalar-to-text' }, {})).toThrow('primitive')
    expect(workflowText({ z: [null], a: false })).toBe('{"a":false,"z":[null]}')
    expect(() => readDataBinding({ address: { from: 'input', name: 'record', pointer: '/__proto__' } }, {})).toThrow()
  })

  it('retains graph and output references when labels change and explicit edges are reordered', () => {
    const renamed = renameNode(newDraft(def), 'first', 'Renamed step').def
    const reordered = { ...renamed, steps: [renamed.steps[2], renamed.steps[1], renamed.steps[0]] }
    expect(renamed.steps[0]).toMatchObject({ id: 'first', name: 'Renamed step' })
    expect(workflowEdges(reordered.steps).get('last')).toEqual(['first'])
    expect(renamed.outputs).toEqual(def.outputs)
    expect(graphOrder(reordered).find(row => row.name === 'last')?.parents).toEqual(['first'])
  })

  it('distinguishes numeric and textual item keys and rejects duplicates', () => {
    const step = {
      id: 'map', name: 'Map', kind: 'workflow-map', items: { step: 'first', pointer: '' }, itemKey: '/id',
      childWorkflow: { ref: { source: 'database' as const, id: 'child' } },
      title: { template: '${id}', bindings: { id: { address: { from: 'item' as const, pointer: '/id' } } } },
    }
    const roster = resolveWorkflowMapRoster(step, {}, [], {}, { first: [{ id: 1 }, { id: '1' }] })
    expect(roster.entries.map(entry => entry.itemKey)).toEqual(['["number",1]', '["string","1"]'])
    expect(() => resolveWorkflowMapRoster(step, {}, [], {}, { first: [{ id: 1 }, { id: 1 }] })).toThrow('repeated')
  })
})
