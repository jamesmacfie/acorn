import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { ExtensionPointId } from '@acorn/plugin-api/node'
import { WorkflowRunner, type RunnerDeps, type WorkflowExtensions } from './workflowRunner'
import type { WorkflowDef, WorkflowStepDef } from '../shared/workflowContracts'

// The human gate over a real runner and a real plugin database (docs/workflows.md § Execution model).
// No step here runs an agent, so no profile or process is involved.

const noExtensions: WorkflowExtensions = { entries: <T>(_point: ExtensionPointId<T>) => [] }

const deps = (over: Partial<RunnerDeps> = {}): RunnerDeps => ({
  runStep: async () => { throw new Error('No agent step runs in these tests.') },
  writeHandoff: async () => {},
  assembleContext: async () => '',
  evaluatePolicy: async () => ({ pass: true }),
  failingChecks: async () => '',
  notify: () => {},
  ...over,
})

const def = (steps: WorkflowStepDef[], extra: Partial<WorkflowDef> = {}): WorkflowDef => ({
  baseline: 'acorn-1', formatVersion: 1, name: 'Approval', steps, ...extra,
})

describe('the human gate', () => {
  let ctx: TestNodeContext
  let runner: WorkflowRunner
  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'workflows' } })
    runner = new WorkflowRunner(ctx.storage.open(), deps(), noExtensions)
  })
  afterEach(() => ctx.cleanup())

  const gated = async (workflow: WorkflowDef) => {
    const runId = await runner.start('task-1', workflow)
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('gated'))
    const gate = (await runner.steps(runId)).find((step) => step.status === 'waiting-gate')!
    return { runId, gate }
  }

  it('takes exactly one answer when two arrive for the same gate', async () => {
    const { runId, gate } = await gated(def([
      { id: 'approve', name: 'approve', kind: 'gate-human' },
      { id: 'check', name: 'check', kind: 'gate-policy', policy: 'checks-green', after: ['approve'] },
    ]))
    const answers = await Promise.all([
      runner.resolveGate(runId, gate.id, true),
      runner.resolveGate(runId, gate.id, false),
    ])
    expect([...answers].sort()).toEqual(['already-resolved', 'resolved'])
    const approvedWon = answers[0] === 'resolved'
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe(approvedWon ? 'done' : 'failed'))
    expect((await runner.steps(runId)).find((step) => step.id === gate.id)?.status).toBe(approvedWon ? 'done' : 'failed')
  })

  it('answers already-resolved after the gate settled, and not-found for another run', async () => {
    const { runId, gate } = await gated(def([{ id: 'approve', name: 'approve', kind: 'gate-human' }]))
    expect(await runner.resolveGate(runId, gate.id, true)).toBe('resolved')
    expect(await runner.resolveGate(runId, gate.id, false)).toBe('already-resolved')
    expect(await runner.resolveGate('another-run', gate.id, true)).toBe('not-found')
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
  })
})
