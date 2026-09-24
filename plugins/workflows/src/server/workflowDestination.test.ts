import { describe, expect, it } from 'vitest'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { ResolvedWorkflowGraph, WorkflowDef } from '../shared/workflowContracts'
import { validateWorkflowDestination } from './workflowDestination'

const reference = (): Extract<QueryReference, { kind: 'inline' }> => ({ kind: 'inline', bindings: {
  connection: { address: { from: 'input', name: 'connection_1', pointer: '' } },
  title: { address: { from: 'step', stepId: 'previous', pointer: '/title' } },
}, content: { name: 'Destination', parameters: { type: 'object', properties: { connection: { type: 'string' }, title: { type: 'string' } }, required: ['connection', 'title'], additionalProperties: false },
  connection: { address: { from: 'input', name: 'connection', pointer: '' } }, sourceParameters: {}, query: {
    source: { pluginId: 'linear', sourceId: 'issues' }, scope: { parameters: { projectId: 'provider-project' } }, sort: [],
    predicate: { kind: 'comparison', operator: 'eq', left: { address: { from: 'item', pointer: '/title' } }, right: { address: { from: 'input', name: 'title', pointer: '' } } },
  } } })
const graph = (query: QueryReference): ResolvedWorkflowGraph => {
  const definition: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Portable', inputs: [{ name: 'connection_1', schema: { type: 'string' }, default: 'destination', connection: { source: { pluginId: 'linear', sourceId: 'issues' } } }], steps: [{ id: 'find', name: 'Find', query }] }
  return { root: definition, nodes: [{ definition, path: ['$'], depth: 0, provenance: { source: 'repo', path: '.acorn/workflows/portable.toml' }, defaultInputs: {}, fingerprint: 'test' }], fingerprint: 'test', requiresRepoTrust: true }
}

describe('destination metadata validation', () => {
  it('checks known provider scope before admission and leaves runtime filters for the data step', async () => {
    const query = reference()
    await validateWorkflowDestination(graph(query), { workspaceId: 'destination-workspace', projectId: 'destination-project' }, async (checked, inputs) => {
      expect(inputs.connection_1).toBe('destination')
      expect(checked.kind).toBe('inline')
      if (checked.kind !== 'inline') throw new Error('Expected inline content')
      expect(checked.content.query.scope).toEqual({ workspaceId: 'destination-workspace', projectId: 'destination-project', parameters: { projectId: 'provider-project' } })
      expect(checked.content.query.predicate).toBeUndefined()
      expect(checked.content.parameters.required).toEqual(['connection'])
    })
    expect(query.content.query.predicate).toBeDefined()
    expect(query.content.parameters.required).toEqual(['connection', 'title'])
  })
  it('refuses a destination scope that needs an unavailable runtime record', async () => {
    const query = reference()
    query.content.sourceParameters.projectId = { address: { from: 'input', name: 'title', pointer: '' } }
    await expect(validateWorkflowDestination(graph(query), { workspaceId: 'destination' }, async () => {})).rejects.toThrow('requires a value')
  })
})
