import { describe, expect, it } from 'vitest'
import type { ResolvedWorkflowGraph, WorkflowDef } from '../shared/workflowContracts'
import { applyScheduleLoopSettings, describeScheduleLoops } from './workflowScheduleModel'

const query = {
  kind: 'inline' as const,
  bindings: {},
  content: {
    name: 'Open issues',
    parameters: { type: 'object' as const, properties: {}, additionalProperties: false as const },
    sourceParameters: {},
    query: { source: { pluginId: 'fixture', sourceId: 'issues' }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
  },
}

const graph = (twoLoops = false): ResolvedWorkflowGraph => {
  const definition: WorkflowDef = {
    baseline: 'acorn-1' as const,
    formatVersion: 1 as const,
    name: 'Triage',
    steps: [
      { id: 'find', name: 'Find issues', kind: 'find-records', query },
      { id: 'loop', name: 'Review issues', kind: 'workflow-map', items: { step: 'find', pointer: '/records' } },
      ...(twoLoops ? [{ id: 'other', name: 'Notify issues', kind: 'workflow-map' as const, items: { step: 'find', pointer: '/records' } }] : []),
    ],
  }
  return {
    root: definition,
    nodes: [{ path: ['$'], depth: 0, definition, provenance: { source: 'database', id: 'workflow', revision: 1 }, defaultInputs: {}, fingerprint: 'node' }],
    fingerprint: 'graph', requiresRepoTrust: false,
  }
}

const source = async () => ({
  label: 'Issues', schema: { type: 'object' as const, properties: { state: { type: 'string' as const } } },
  fields: [{ pointer: '/state', label: 'State', origin: 'declared' as const }], incremental: true,
})

describe('workflow schedule setup model', () => {
  it('describes only record loops and prefixes tracked fields into the durable record snapshot', async () => {
    const loops = await describeScheduleLoops(graph(), { workspaceId: 'w' }, {}, source)
    expect(loops).toHaveLength(1)
    expect(loops[0]).toMatchObject({ label: 'Review issues', sourceLabel: 'Issues', checkpointAvailable: true })
    expect(loops[0]!.fields).toContainEqual(expect.objectContaining({ pointer: '/data/state', label: 'State' }))

    const ordinary = graph()
    ordinary.root.steps[0] = { id: 'find', name: 'Produce values', kind: 'agent', prompt: 'Return values.' }
    expect(await describeScheduleLoops(ordinary, { workspaceId: 'w' }, {}, source)).toEqual([])
  })

  it('withholds checkpoint selection when one query feeds several tracked loops', async () => {
    const loops = await describeScheduleLoops(graph(true), { workspaceId: 'w' }, {}, source)
    expect(loops).toHaveLength(2)
    expect(loops.every(loop => !loop.checkpointAvailable)).toBe(true)
    expect(loops[0]!.checkpointReason).toMatch(/more than one loop/)
  })

  it('applies repeat fields to the loop and continuation to its source without changing other steps', async () => {
    const original = graph()
    const loops = await describeScheduleLoops(original, { workspaceId: 'w' }, {}, source)
    const configured = [{ loopId: loops[0]!.loopId, repeat: { mode: 'changed' as const, fields: ['/data/state'] }, incremental: true }]
    const applied = applyScheduleLoopSettings(original, loops, configured)
    expect(applied.root.steps.find(step => step.id === 'find')?.incremental).toBe(true)
    expect(applied.root.steps.find(step => step.id === 'loop')?.repeat).toEqual({ mode: 'changed', fields: ['/data/state'] })
    expect(original.root.steps.find(step => step.id === 'find')?.incremental).toBeUndefined()
  })

  it('refuses forged checkpoint and empty selected-field settings', async () => {
    const original = graph(true)
    const loops = await describeScheduleLoops(original, { workspaceId: 'w' }, {}, source)
    expect(() => applyScheduleLoopSettings(original, loops, [{ loopId: loops[0]!.loopId, repeat: { mode: 'changed', fields: [] }, incremental: true }]))
      .toThrow(/Select at least one tracked field/)
    expect(() => applyScheduleLoopSettings(original, loops, [{ loopId: loops[0]!.loopId, repeat: { mode: 'changed', fields: ['/data/private'] }, incremental: false }]))
      .toThrow(/no longer available/)
  })
})
