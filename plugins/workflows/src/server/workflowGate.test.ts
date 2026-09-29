import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { ExtensionPointId } from '@acorn/plugin-api/node'
import { WorkflowRunner, type RunnerDeps, type WorkflowExtensions } from './runs/runner'
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
  afterEach(() => {
    runner.stop()
    ctx.cleanup()
  })

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
    const answers = (await Promise.all([
      runner.resolveGate(runId, gate.id, true),
      runner.resolveGate(runId, gate.id, false),
    ])).map((answer) => answer.outcome)
    expect([...answers].sort()).toEqual(['already-resolved', 'resolved'])
    const approvedWon = answers[0] === 'resolved'
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe(approvedWon ? 'done' : 'failed'))
    expect((await runner.steps(runId)).find((step) => step.id === gate.id)?.status).toBe(approvedWon ? 'done' : 'failed')
  })

  it('answers already-resolved after the gate settled, and not-found for another run', async () => {
    const { runId, gate } = await gated(def([{ id: 'approve', name: 'approve', kind: 'gate-human' }]))
    expect(await runner.resolveGate(runId, gate.id, true)).toEqual({ outcome: 'resolved' })
    expect(await runner.resolveGate(runId, gate.id, false)).toEqual({ outcome: 'already-resolved' })
    expect(await runner.resolveGate('another-run', gate.id, true)).toEqual({ outcome: 'not-found' })
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
  })

  describe('with a form', () => {
    const title = { name: 'title', label: 'Title', schema: { type: 'string' as const }, required: true }
    const notify = { name: 'notify', schema: { type: 'boolean' as const }, default: false }
    const formDef = (extra: Partial<WorkflowDef> = {}) => def([
      { id: 'approve', name: 'approve', kind: 'gate-human', after: [], form: {
        fields: [title, notify],
        values: { title: { address: { from: 'input', name: 'title', pointer: '' } } },
      } },
      // A later step reads the approved value, which is the point of the form.
      { id: 'branch', name: 'branch', kind: 'if', after: ['approve'], branches: { true: 'yes', otherwise: 'no' },
        condition: { kind: 'comparison', left: { address: { from: 'step', stepId: 'approve', pointer: '/values/notify' } }, operator: 'eq', right: { address: { from: 'literal', value: true } } } },
      { id: 'yes', name: 'yes', kind: 'gate-policy', policy: 'checks-green', after: ['branch'] },
      { id: 'no', name: 'no', kind: 'gate-policy', policy: 'checks-green', after: ['branch'] },
    ], { inputs: [{ name: 'title', schema: { type: 'string' } }], ...extra })
    const start = async (inputs: Record<string, string> = { title: 'Proposed' }, extra: Partial<WorkflowDef> = {}) => {
      const runId = await runner.start('task-1', formDef(extra), { inputs })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toMatch(/gated|done|failed/))
      return { runId, rows: await runner.steps(runId) }
    }
    const step = async (runId: string, id: string) => (await runner.steps(runId)).find((row) => row.name === id)!

    it('freezes the proposal, writes the approved values, and a later step reads them', async () => {
      const { runId } = await start()
      const gate = await step(runId, 'approve')
      expect(JSON.parse(gate.inputsJson!).form).toEqual({ values: { title: 'Proposed', notify: false } })

      expect(await runner.resolveGate(runId, gate.id, true, { title: 'Corrected', notify: true })).toEqual({ outcome: 'resolved' })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
      expect(JSON.parse((await step(runId, 'approve')).structuredJson!)).toEqual({ approved: true, values: { title: 'Corrected', notify: true }, edited: ['title', 'notify'] })
      expect((await step(runId, 'yes')).status).toBe('done')
      expect((await step(runId, 'no')).status).toBe('skipped')
    })

    it('approves the proposal as it stands when no values are sent', async () => {
      const { runId } = await start()
      expect(await runner.resolveGate(runId, (await step(runId, 'approve')).id, true)).toEqual({ outcome: 'resolved' })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
      expect(JSON.parse((await step(runId, 'approve')).structuredJson!)).toMatchObject({ values: { title: 'Proposed', notify: false }, edited: [] })
    })

    it('refuses unknown fields, wrong types, empty required fields, and values on a rejection, and keeps waiting', async () => {
      const { runId } = await start({})
      const gate = await step(runId, 'approve')
      expect(await runner.resolveGate(runId, gate.id, true)).toEqual({ outcome: 'invalid', problems: { title: 'A value is required.' } })
      const answer = await runner.resolveGate(runId, gate.id, true, { title: 'Fine', notify: 'yes', extra: 1 })
      expect(answer.outcome === 'invalid' && Object.keys(answer.problems).sort()).toEqual(['extra', 'notify'])
      expect((await runner.resolveGate(runId, gate.id, false, { title: 'x' })).outcome).toBe('invalid')
      expect((await step(runId, 'approve')).status).toBe('waiting-gate')
      expect(await runner.resolveGate(runId, gate.id, true, { title: 'Fine', notify: false })).toEqual({ outcome: 'resolved' })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
    })

    it('approves the proposal unchanged under an autonomous posture, and fails when a required field is empty', async () => {
      const autonomous = { posture: 'autonomous' as const, tools: { maxRisk: 'read' as const } }
      const { runId } = await start({ title: 'Proposed' }, autonomous)
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
      expect(JSON.parse((await step(runId, 'approve')).structuredJson!)).toEqual({ approved: 'autonomous', values: { title: 'Proposed', notify: false }, edited: [] })

      const empty = await start({}, autonomous)
      expect((await runner.run(empty.runId))?.status).toBe('failed')
      expect((await step(empty.runId, 'approve')).error).toBe('The run is autonomous, so nobody was asked to fill the required form fields: title.')
    })
  })
})
