import { describe, expect, it, vi } from 'vitest'
import type { AuthoringTurnRequest } from '@acorn/protocol/authoring.ts'
import type { DataSourceRequest, DataSourceResponse } from '@acorn/protocol/dataSources.ts'
import type { WorkflowCatalog, WorkflowDef } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { catalogValidation } from './generate'
import { BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from '../steps/builtins'
import { authorWorkflowConversation, type SourceRuntime } from './conversation'

const original: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Review', steps: [{ id: 'read', name: 'read', prompt: 'Read the issue.' }] }
const proposed: WorkflowDef = { ...original, steps: [{ id: 'read', name: 'read', prompt: 'Read the issue and summarize the risk.' }] }
const catalog: WorkflowCatalog = {
  kinds: [...BUILTIN_STEP_KINDS, 'workflow', 'workflow-map'].map(id => ({ id, pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS[id] ?? null })),
  policies: [], profiles: [{ id: 'claude-code', label: 'Claude Code', managed: true, structured: true }],
  workflows: [{ ref: { source: 'database', id: 'triage' }, name: 'Triage', inputs: [{ name: 'issue', required: true }] }],
}
const validation = {
  ...catalogValidation(catalog),
  validateStepKind: (kind: string, step: WorkflowDef['steps'][number], context: Parameters<NonNullable<(typeof BUILTIN_STEP_VALIDATORS)[keyof typeof BUILTIN_STEP_VALIDATORS]>>[1]) =>
    BUILTIN_STEP_VALIDATORS[kind as keyof typeof BUILTIN_STEP_VALIDATORS]?.(step, context) ?? [],
}
const turn = (backendId: string, samplesEnabled = false): AuthoringTurnRequest => ({
  target: 'workflow', scope: { workspaceId: 'w1', projectId: 'p1' }, targetId: 'wf1', baseRevision: 4,
  base: original, backendId, instruction: 'Use the real source and child workflow.', context: [], samplesEnabled,
})
const answer = (value: unknown) => ({ text: JSON.stringify(value), providerId: 'fake', modelId: 'fake-model' })

function sourceRuntime() {
  return {
    list: vi.fn(async () => ({ sources: [], discoveries: [{ pluginId: 'github', discoveryId: 'repositories', providerId: 'github' }] })),
    discoverAvailable: vi.fn(async () => ({
      sources: [{ pluginId: 'github', sourceId: 'repo:acorn', name: 'Acorn issues', singular: 'issue', plural: 'issues', identityScope: 'repository', providerId: 'github' }],
      exhausted: true,
    })),
    invoke: vi.fn(async <R extends DataSourceRequest>(request: R): Promise<DataSourceResponse<R>> => {
      if (request.operation === 'query') {
        return {
          records: [{ ref: { pluginId: 'github', sourceId: 'repo:acorn', recordId: '1' }, data: { title: 'A'.repeat(20_000), secret: 'not selected' } }],
          revision: 'r1', readTime: 1, completeness: { kind: 'complete' }, mode: 'preview', evaluationTime: 1,
        } as unknown as DataSourceResponse<R>
      }
      throw new Error(`unexpected ${request.operation}`)
    }),
  }
}

describe.each(['connection:model-key', 'harness:codex'])('workflow conversation through %s', backendId => {
  it('discovers real sources and child targets before returning a validated proposal', async () => {
    const sources = sourceRuntime()
    const generate = vi.fn()
      .mockResolvedValueOnce(answer({ kind: 'metadata', request: { operation: 'discover-sources', pluginId: 'github', discoveryId: 'repositories', scope: { workspaceId: 'w1', projectId: 'p1', parameters: {} }, pageSize: 10 } }))
      .mockResolvedValueOnce(answer({ kind: 'metadata', request: { operation: 'list-workflows' } }))
      .mockResolvedValue(answer({ kind: 'proposal', candidate: proposed, summary: 'Strengthen the review step.' }))
    const result = await authorWorkflowConversation({
      request: turn(backendId), catalog, validation, principal: { kind: 'device', userId: 'u1', deviceId: 'd1' },
      signal: new AbortController().signal, sources: sources as unknown as SourceRuntime, generate,
    })
    expect(sources.discoverAvailable).toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'github', discoveryId: 'repositories' }), expect.anything())
    expect(generate.mock.calls[2]?.[0].prompt).toContain('Triage')
    expect(result).toMatchObject({ state: 'proposal', baseRevision: 4, candidate: proposed, problems: [] })
  })
})

it('keeps samples opt-in and omits an oversized selected preview instead of truncating it', async () => {
  const query = { source: { pluginId: 'github', sourceId: 'repo:acorn' }, scope: { workspaceId: 'w1', projectId: 'p1', parameters: {} }, sort: [] }
  for (const [enabled, expected] of [[false, 'disabled'], [true, 'does not fit']] as const) {
    const sources = sourceRuntime()
    const generate = vi.fn()
      .mockResolvedValueOnce(answer({ kind: 'metadata', request: { operation: 'preview-sample', query, fields: ['/title'] } }))
      .mockResolvedValue(answer({ kind: 'proposal', candidate: proposed, summary: 'Done.' }))
    const result = await authorWorkflowConversation({
      request: turn('connection:model-key', enabled), catalog, validation,
      principal: { kind: 'device', userId: 'u1', deviceId: 'd1' }, signal: new AbortController().signal, sources: sources as unknown as SourceRuntime, generate,
    })
    expect(generate.mock.calls[1]?.[0].prompt).toContain(expected)
    expect(sources.invoke).toHaveBeenCalledTimes(enabled ? 1 : 0)
    expect(result.state).toBe('proposal')
  }
})

it('returns an applicable item-agent edit when the model writes items as a plain step binding', async () => {
  const expected: WorkflowDef = { ...original, name: 'Dependabot review', steps: [
    { id: 'identify', name: 'Identify issues', after: [], prompt: 'Identify issues.', schema: { type: 'object', properties: {
      issues: { type: 'array', items: { type: 'object', properties: { issueId: { type: 'string' } } } },
    } } },
    { id: 'fix', name: 'Fix each issue in its own agent session', kind: 'workflow-map', after: ['identify'],
      items: { step: 'identify', pointer: '/issues' }, itemKey: '/issueId',
      agent: { prompt: 'Fix this issue and test it.', profileId: 'claude-code', onFailure: 'continue' } },
    { id: 'review', name: 'Review the fixes', after: ['fix'], prompt: 'Review every issue and its session result.' },
  ] }
  const candidate = { ...expected, steps: expected.steps.map(step => step.id === 'fix'
    ? { ...step, items: { address: { from: 'step', stepId: 'identify', pointer: '/issues' } } } : step) }
  const generate = vi.fn().mockResolvedValue(answer({ kind: 'proposal', candidate, summary: 'Run a session for each issue.' }))
  const result = await authorWorkflowConversation({
    request: { ...turn('harness:codex'), instruction: 'Run a separate agent session for each issue.' },
    catalog: { ...catalog, workflows: [] }, validation, generate,
    principal: { kind: 'device', userId: 'u1', deviceId: 'd1' }, signal: new AbortController().signal,
    sources: sourceRuntime() as unknown as SourceRuntime,
  })
  expect(result).toMatchObject({ state: 'proposal', candidate: expected, problems: [], usage: { requests: 1 } })
})
