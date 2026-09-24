import { describe, expect, it, vi } from 'vitest'
import type { StepHandlerContext, WorkflowStepRow } from '../shared/workflowContracts'
import { assertWorkflowDataScope, workflowDataHandlers, type WorkflowDataAccess } from './workflowDataSteps'
import { parseWorkflowToml } from './workflowFiles'
import { writeWorkflowToml } from './workflowToml'

const scope = { workspaceId: 'workspace', projectId: 'project', parameters: { project: 'dynamic' } }
const source = { pluginId: 'fixture', sourceId: 'records' }
const query = { source, scope, sort: [] }
const reference = { kind: 'inline' as const, content: { name: 'Items', parameters: { type: 'object' as const, properties: {}, additionalProperties: false }, query, sourceParameters: {} }, bindings: {} }
const step = { id: 'find', name: 'Find', kind: 'find-records', query: reference }
const context = (): StepHandlerContext => ({ def: step, step: { id: 'row', inputsJson: null } as WorkflowStepRow, run: { taskId: 'task' } as StepHandlerContext['run'], inputs: {}, predecessorValues: {}, signal: new AbortController().signal, renderedPrompt: '', tools: {}, budget: {}, upstream: [], emit() {} })
const selection = { records: [], mode: 'execution', revision: '1', evaluationTime: 123, readTime: 124, completeness: { kind: 'complete' } }
function harness() {
  const resolve = vi.fn(async () => ({ query, parameters: {} }))
  const invoke = vi.fn(async () => selection)
  const setStep = vi.fn(async (_id: string, _patch: Partial<WorkflowStepRow>) => {})
  const access = vi.fn(async () => ({ scope, resolve, invoke }) as unknown as WorkflowDataAccess)
  return { resolve, invoke, setStep, handlers: workflowDataHandlers({ access, setStep }) }
}

describe('workflow data and condition steps', () => {
  it('admits an authored workspace query in a project run and rejects another project or workspace', () => {
    expect(() => assertWorkflowDataScope(scope, { workspaceId: scope.workspaceId })).not.toThrow()
    expect(() => assertWorkflowDataScope(scope, scope)).not.toThrow()
    expect(() => assertWorkflowDataScope(scope, { workspaceId: scope.workspaceId, projectId: 'other' })).toThrow('outside')
    expect(() => assertWorkflowDataScope(scope, { workspaceId: 'other' })).toThrow('outside')
  })
  it('persists frozen arguments before querying and reuses them across retries', async () => {
    const h = harness()
    const ctx = context()
    h.invoke.mockImplementation(async () => { expect(h.setStep).toHaveBeenCalledOnce(); return selection })
    const first = await h.handlers['find-records'](ctx)
    expect(first).toMatchObject({ status: 'done', structured: { records: [], provenance: { query } } })
    // Read the durable patch, as a fresh runner would after a crash.
    ctx.step.inputsJson = h.setStep.mock.calls[0][1].inputsJson ?? null
    await h.handlers['find-records'](ctx)
    expect(h.resolve).toHaveBeenCalledOnce()
    expect(h.invoke.mock.calls[0]).toEqual(h.invoke.mock.calls[1])
  })
  it('rejects incomplete and oversized selections before producing a dispatchable output', async () => {
    const h = harness()
    h.invoke.mockResolvedValue({ ...selection, completeness: { kind: 'incomplete' } })
    await expect(h.handlers['find-records'](context())).rejects.toThrow('Incomplete selection')
    h.invoke.mockResolvedValue({ ...selection, records: [{ data: 'x'.repeat(17 * 1024 * 1024) }] } as never)
    await expect(h.handlers['find-records'](context())).rejects.toThrow()
  })
  it('does not hide source revocation on a retry', async () => {
    const h = harness()
    const ctx = context()
    ctx.step.inputsJson = JSON.stringify({ dataSelection: { resolved: { query, parameters: {} }, evaluationTime: 1 } })
    h.invoke.mockRejectedValue(new Error('forbidden'))
    await expect(h.handlers['find-records'](ctx)).rejects.toThrow('forbidden')
    expect(h.resolve).not.toHaveBeenCalled()
  })
  it('retains exact reference scope, typed details and fetched time; missing records fail', async () => {
    const h = harness()
    const ref = { ...source, recordId: 'record', scope }
    const ctx = { ...context(), def: { name: 'Details', kind: 'get-record-details', record: { address: { from: 'literal' as const, value: ref } } } }
    h.invoke.mockResolvedValue({ kind: 'found', data: { title: 'Hello' }, fetchedTime: 5, schema: { type: 'object' } } as never)
    expect(await h.handlers['get-record-details'](ctx)).toMatchObject({ status: 'done', structured: { ref, fetchedTime: 5, data: { title: 'Hello' } } })
    expect(h.invoke).toHaveBeenCalledWith({ operation: 'details', ref, scope, projection: [] })
    h.invoke.mockResolvedValue({ kind: 'not-found' } as never)
    await expect(h.handlers['get-record-details'](ctx)).rejects.toThrow('Record not found')
  })
  it('evaluates true, false and missing optional fields without source or model calls', async () => {
    const h = harness()
    const ctx = context()
    ctx.def = { name: 'If', kind: 'if', condition: { kind: 'comparison', left: { address: { from: 'input', name: 'enabled', pointer: '' } }, operator: 'eq', right: { address: { from: 'literal', value: true } } } }
    ctx.inputs = { enabled: true }
    expect(await h.handlers.if(ctx)).toMatchObject({ structured: { matched: true, verdict: 'true' } })
    ctx.inputs = { enabled: false }
    expect(await h.handlers.if(ctx)).toMatchObject({ structured: { matched: false, verdict: 'otherwise' } })
    ctx.inputs = {}
    await expect(h.handlers.if(ctx)).rejects.toThrow('missing')
    ctx.def.condition = { kind: 'comparison', left: { address: { from: 'input', name: 'enabled', pointer: '' } }, operator: 'missing' }
    expect(await h.handlers.if(ctx)).toMatchObject({ structured: { matched: true } })
    expect(h.invoke).not.toHaveBeenCalled()
  })
  it('round trips data step configuration in repository files', () => {
    const errors: { source: string; message: string }[] = []
    expect(parseWorkflowToml(writeWorkflowToml({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Data', steps: [step] }), 'test', 'repo', errors)).toMatchObject({ steps: [step] })
    expect(errors).toEqual([])
  })
})
