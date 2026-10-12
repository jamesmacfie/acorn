import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { Extension, ExtensionPointId } from '@acorn/plugin-api/node'
import { WorkflowRunner, type RunnerDeps, type WorkflowExtensions } from './runs/runner'
import { WORKFLOW_POLICY } from '../contract/extensions'
import { readPolicyWait } from '../shared/policyWait'
import type {
  PolicyContext,
  PolicyContribution,
  PolicyVerdict,
  WorkflowDef,
  WorkflowStepDef,
} from '../shared/workflowContracts'

// The human gate and the policy gate over a real runner and a real plugin database
// (docs/workflows/execution.md § Execution model). No step here runs an agent, so no profile or
// process is involved.

/** A policy that answers from a script. The last answer repeats. */
const scripted = (...answers: PolicyVerdict[]) => {
  let poll = 0
  return {
    describe: { label: 'Scripted', description: 'Answers from a script.', icon: 'list', fields: [] },
    evaluate: vi.fn(async (_ctx: PolicyContext) => answers[Math.min(poll++, answers.length - 1)]!),
  } satisfies PolicyContribution
}

const policies = (entries: Record<string, PolicyContribution>): WorkflowExtensions => ({
  handlers: <T>(point: ExtensionPointId<T>) =>
    (point === WORKFLOW_POLICY
      ? Object.entries(entries).map(([id, value]) => ({ id, pluginId: 'test', order: 0, value }))
      : []) as Extension<T>[],
})

const passing = () => policies({ 'test:pass': scripted({ verdict: 'pass' }) })

const deps = (over: Partial<RunnerDeps> = {}): RunnerDeps => ({
  runStep: async () => {
    throw new Error('No agent step runs in these tests.')
  },
  writeHandoff: async () => {},
  assembleContext: async () => '',
  notify: () => {},
  ...over,
})

const def = (steps: WorkflowStepDef[], extra: Partial<WorkflowDef> = {}): WorkflowDef => ({
  baseline: 'acorn-1',
  formatVersion: 1,
  name: 'Approval',
  steps,
  ...extra,
})

describe('the human gate', () => {
  let ctx: TestNodeContext
  let runner: WorkflowRunner
  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'workflows' } })
    runner = new WorkflowRunner(ctx.storage.open(), deps(), passing())
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
    const { runId, gate } = await gated(
      def([
        { id: 'approve', name: 'approve', kind: 'gate-human' },
        { id: 'check', name: 'check', kind: 'gate-policy', policy: 'test:pass', after: ['approve'] },
      ]),
    )
    const answers = (
      await Promise.all([runner.resolveGate(runId, gate.id, true), runner.resolveGate(runId, gate.id, false)])
    ).map((answer) => answer.outcome)
    expect([...answers].sort()).toEqual(['already-resolved', 'resolved'])
    const approvedWon = answers[0] === 'resolved'
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe(approvedWon ? 'done' : 'failed'))
    expect((await runner.steps(runId)).find((step) => step.id === gate.id)?.status).toBe(
      approvedWon ? 'done' : 'failed',
    )
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
    const formDef = (extra: Partial<WorkflowDef> = {}) =>
      def(
        [
          {
            id: 'approve',
            name: 'approve',
            kind: 'gate-human',
            after: [],
            form: {
              fields: [title, notify],
              values: { title: { address: { from: 'input', name: 'title', pointer: '' } } },
            },
          },
          // A later step reads the approved value, which is the point of the form.
          {
            id: 'branch',
            name: 'branch',
            kind: 'if',
            after: ['approve'],
            branches: { true: 'yes', otherwise: 'no' },
            condition: {
              kind: 'comparison',
              left: { address: { from: 'step', stepId: 'approve', pointer: '/values/notify' } },
              operator: 'eq',
              right: { address: { from: 'literal', value: true } },
            },
          },
          { id: 'yes', name: 'yes', kind: 'gate-policy', policy: 'test:pass', after: ['branch'] },
          { id: 'no', name: 'no', kind: 'gate-policy', policy: 'test:pass', after: ['branch'] },
        ],
        { inputs: [{ name: 'title', schema: { type: 'string' } }], ...extra },
      )
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

      expect(await runner.resolveGate(runId, gate.id, true, { title: 'Corrected', notify: true })).toEqual({
        outcome: 'resolved',
      })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
      expect(JSON.parse((await step(runId, 'approve')).structuredJson!)).toEqual({
        approved: true,
        values: { title: 'Corrected', notify: true },
        edited: ['title', 'notify'],
      })
      expect((await step(runId, 'yes')).status).toBe('done')
      expect((await step(runId, 'no')).status).toBe('skipped')
    })

    it('approves the proposal as it stands when no values are sent', async () => {
      const { runId } = await start()
      expect(await runner.resolveGate(runId, (await step(runId, 'approve')).id, true)).toEqual({ outcome: 'resolved' })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
      expect(JSON.parse((await step(runId, 'approve')).structuredJson!)).toMatchObject({
        values: { title: 'Proposed', notify: false },
        edited: [],
      })
    })

    it('refuses unknown fields, wrong types, empty required fields, and values on a rejection, and keeps waiting', async () => {
      const { runId } = await start({})
      const gate = await step(runId, 'approve')
      expect(await runner.resolveGate(runId, gate.id, true)).toEqual({
        outcome: 'invalid',
        problems: { title: 'A value is required.' },
      })
      const answer = await runner.resolveGate(runId, gate.id, true, { title: 'Fine', notify: 'yes', extra: 1 })
      expect(answer.outcome === 'invalid' && Object.keys(answer.problems).sort()).toEqual(['extra', 'notify'])
      expect((await runner.resolveGate(runId, gate.id, false, { title: 'x' })).outcome).toBe('invalid')
      expect((await step(runId, 'approve')).status).toBe('waiting-gate')
      expect(await runner.resolveGate(runId, gate.id, true, { title: 'Fine', notify: false })).toEqual({
        outcome: 'resolved',
      })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
    })

    it('approves the proposal unchanged under an autonomous posture, and fails when a required field is empty', async () => {
      const autonomous = { posture: 'autonomous' as const, tools: { maxRisk: 'read' as const } }
      const { runId } = await start({ title: 'Proposed' }, autonomous)
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
      expect(JSON.parse((await step(runId, 'approve')).structuredJson!)).toEqual({
        approved: 'autonomous',
        values: { title: 'Proposed', notify: false },
        edited: [],
      })

      const empty = await start({}, autonomous)
      expect((await runner.run(empty.runId))?.status).toBe('failed')
      expect((await step(empty.runId, 'approve')).error).toBe(
        'The run is autonomous, so nobody was asked to fill the required form fields: title.',
      )
    })
  })
})

describe('the policy gate', () => {
  let ctx: TestNodeContext
  const runners: WorkflowRunner[] = []
  const runnerWith = (extensions: WorkflowExtensions, over: Partial<RunnerDeps> = {}) => {
    const runner = new WorkflowRunner(ctx.storage.open(), deps(over), extensions)
    runners.push(runner)
    return runner
  }
  // The sleep between polls moves the clock instead of waiting, so a day-long timeout takes no time.
  const clockSleep = async (ms: number) => {
    vi.setSystemTime(Date.now() + ms)
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    ctx = makeTestNodeContext({ plugin: { name: 'workflows' } })
  })
  afterEach(() => {
    for (const runner of runners.splice(0)) runner.stop()
    ctx.cleanup()
    vi.useRealTimers()
  })

  const settled = async (runner: WorkflowRunner, runId: string) => {
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toMatch(/^(done|failed)$/))
    return runner.steps(runId)
  }

  it('asks again while the policy says wait, and finishes on pass', async () => {
    const policy = scripted({ verdict: 'wait', detail: 'Not yet' }, { verdict: 'wait' }, { verdict: 'pass' })
    const runner = runnerWith(policies({ 'test:ci': policy }), { sleep: clockSleep })
    const runId = await runner.start(
      'task-1',
      def([{ id: 'ci', name: 'ci', kind: 'gate-policy', policy: 'test:ci', timeoutMs: 3_600_000 }]),
    )
    const [gate] = await settled(runner, runId)
    expect(gate!.status).toBe('done')
    expect(JSON.parse(gate!.structuredJson!)).toEqual({ verdict: 'pass', polls: 3 })
    expect(policy.evaluate).toHaveBeenCalledTimes(3)
    // The second poll is told what the first said.
    expect(policy.evaluate.mock.calls[1]![0].previous).toEqual({ verdict: 'wait', detail: 'Not yet' })
    // A settled wait leaves nothing behind, so a retry would start a fresh one.
    expect(readPolicyWait(gate!.inputsJson)).toBeUndefined()
  })

  it('reads wait as fail when the gate asks only once', async () => {
    const runner = runnerWith(policies({ 'test:ci': scripted({ verdict: 'wait', detail: 'Still running' }) }))
    const runId = await runner.start('task-1', def([{ id: 'ci', name: 'ci', kind: 'gate-policy', policy: 'test:ci' }]))
    const [gate] = await settled(runner, runId)
    expect(gate!.status).toBe('failed')
    expect(gate!.error).toBe("Policy 'test:ci' failed: Still running")
  })

  it('keeps since and the deadline across a restart, and times out at the original deadline', async () => {
    const policy = scripted({ verdict: 'wait' })
    const workflow = def([
      { id: 'ci', name: 'ci', kind: 'gate-policy', policy: 'test:ci', intervalMs: 30_000, timeoutMs: 60_000 },
    ])
    // The first Node polls once, then is shut down while it sleeps.
    const first = runnerWith(policies({ 'test:ci': policy }), {
      sleep: (_ms, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve())),
    })
    const runId = await first.start('task-1', workflow)
    let saved: ReturnType<typeof readPolicyWait>
    await vi.waitFor(async () => {
      saved = readPolicyWait((await first.steps(runId))[0]!.inputsJson)
      expect(saved?.state).toBe('sleeping')
    })
    expect(saved!.polls).toBe(1)
    first.stop()

    vi.setSystemTime(Date.now() + 10_000)
    const second = runnerWith(policies({ 'test:ci': policy }), { sleep: clockSleep })
    await second.reconcile()
    const [gate] = await settled(second, runId)
    expect(gate!.status).toBe('failed')
    expect(JSON.parse(gate!.structuredJson!)).toMatchObject({ verdict: 'timed-out' })
    // Every poll, before and after the restart, measured from the same start.
    expect(new Set(policy.evaluate.mock.calls.map(([call]) => call.since))).toEqual(new Set([saved!.since]))
    // Polls at the restart, 30 seconds later, and on the deadline itself: 60 seconds after the start,
    // not 60 seconds after the restart.
    expect(JSON.parse(gate!.structuredJson!).polls).toBe(4)
    // The faked clock still drifts with real time by a few milliseconds, so this is a window.
    expect(Date.now()).toBeGreaterThanOrEqual(saved!.deadlineAt)
    expect(Date.now()).toBeLessThan(saved!.deadlineAt + 1_000)
  })

  it('takes the timed-out branch and skips the pass branch', async () => {
    const runner = runnerWith(
      policies({ 'test:ci': scripted({ verdict: 'wait' }), 'test:pass': scripted({ verdict: 'pass' }) }),
      {
        sleep: clockSleep,
      },
    )
    const runId = await runner.start(
      'task-1',
      def([
        {
          id: 'await',
          name: 'await',
          kind: 'gate-policy',
          policy: 'test:ci',
          intervalMs: 30_000,
          timeoutMs: 60_000,
          branches: { pass: 'next', 'timed-out': 'nudge' },
        },
        { id: 'next', name: 'next', kind: 'gate-policy', policy: 'test:pass', after: ['await'] },
        { id: 'nudge', name: 'nudge', kind: 'gate-policy', policy: 'test:pass', after: ['await'] },
      ]),
    )
    const steps = await settled(runner, runId)
    expect((await runner.run(runId))?.status).toBe('done')
    expect(Object.fromEntries(steps.map((step) => [step.name, step.status]))).toEqual({
      await: 'done',
      next: 'skipped',
      nudge: 'done',
    })
  })

  it('fails the step after three failed polls in a row', async () => {
    const policy = {
      ...scripted({ verdict: 'wait' }),
      evaluate: vi.fn(async (): Promise<PolicyVerdict> => {
        throw new Error('token revoked')
      }),
    }
    const runner = runnerWith(policies({ 'test:ci': policy }), { sleep: clockSleep })
    const runId = await runner.start(
      'task-1',
      def([{ id: 'ci', name: 'ci', kind: 'gate-policy', policy: 'test:ci', timeoutMs: 86_400_000 }]),
    )
    const [gate] = await settled(runner, runId)
    expect(gate!.error).toBe("Policy 'test:ci' could not be checked: token revoked")
    expect(policy.evaluate).toHaveBeenCalledTimes(3)
  })
})
