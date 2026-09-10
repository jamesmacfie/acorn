import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { agentProfileRegistry, DEFAULT_PROFILE_ID, type ExtensionPointId, type PluginTelemetry, type TelemetryRecord } from '@acorn/plugin-api/node'
import { WorkflowRunner, type RunnerDeps, type WorkflowExtensions } from './workflowRunner'

// A run and its steps as spans, raised by this plugin through `ctx.telemetry` and owned by it
// (docs/workflows.md § What a run reports). Core adds nothing workflow-shaped: a compiled plugin
// with a context measures its own work.

const noExtensions: WorkflowExtensions = { entries: <T>(_point: ExtensionPointId<T>) => [] }

const ok = {
  status: 'ok' as const,
  exitCode: 0,
  capture: { result: 'done', structuredOutput: null, sessionId: null, costUsd: null, events: [] },
  stderrTail: '',
}

type Span = Extract<TelemetryRecord, { kind: 'span' }>

/** The spans this plugin raised, from the testkit's recorder rather than a stand-in for
 *  `ctx.telemetry`: these are the records a sink would receive, built by the real verbs
 *  (docs/plugin-authoring.md § In tests). A span appears once it has ended, and the attributes it
 *  ended with are merged into the ones it opened with. */
const spans = (ctx: TestNodeContext): Span[] =>
  ctx.recorded.filter((record): record is Span => record.kind === 'span')

const baseDeps = (telemetry: PluginTelemetry, over: Partial<RunnerDeps> = {}): RunnerDeps => ({
  runStep: async () => ok,
  writeHandoff: async () => {},
  assembleContext: async () => '',
  evaluatePolicy: async () => ({ pass: true }),
  failingChecks: async () => '',
  notify: () => {},
  telemetry,
  ...over,
})

const withProfile = async (body: () => Promise<void>): Promise<void> => {
  const profile = agentProfileRegistry.register({
    id: DEFAULT_PROFILE_ID, label: 'Claude Code', kind: 'agent', command: 'claude',
    backendPreference: 'tmux', transport: 'pty',
  })
  try {
    await body()
  } finally {
    profile()
  }
}

describe('what a run reports', () => {
  let ctx: TestNodeContext
  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'workflows' } })
  })
  afterEach(() => {
    ctx.cleanup()
  })

  it('raises one span for the run and one per step, and hangs the steps under the run', async () => {
    await withProfile(async () => {
      const runner = new WorkflowRunner(ctx.storage.open(), baseDeps(ctx.telemetry), noExtensions)
      const runId = await runner.start('task-1', {
        name: 'W',
        steps: [{ name: 'one', kind: 'agent', prompt: 'go' }, { name: 'two', kind: 'agent', prompt: 'go', after: ['one'] }],
      })
      await vi.waitFor(() => expect(spans(ctx)).toHaveLength(3))

      const run = spans(ctx).find((span) => span.name === 'workflow.run')!
      expect(run.attrs).toMatchObject({ seam: 'workflow.run', 'run.id': runId, steps: 2, status: 'done', owner: 'workflows' })
      expect(run.status).toBe('ok')

      const steps = spans(ctx).filter((span) => span.name === 'workflow.step')
      expect(steps).toHaveLength(2)
      // One trace for the run and everything under it, which is what makes a slow step findable
      // from the run rather than from a list of unrelated spans.
      for (const step of steps) {
        expect(step.traceId).toBe(run.traceId)
        expect(step.attrs).toMatchObject({ seam: 'workflow.step', 'run.id': runId })
        expect(step.status).toBe('ok')
      }
    })
  })

  it('marks a failed step and the run it failed as errors, with the status they ended on', async () => {
    await withProfile(async () => {
      const runner = new WorkflowRunner(
        ctx.storage.open(),
        baseDeps(ctx.telemetry, { runStep: async () => ({ ...ok, status: 'error' as const, stderrTail: 'no' }) }),
        noExtensions,
      )
      await runner.start('task-1', { name: 'W', steps: [{ name: 'one', kind: 'agent', prompt: 'go' }] })
      await vi.waitFor(() => expect(spans(ctx)).toHaveLength(2))
      expect(spans(ctx).find((span) => span.name === 'workflow.step')).toMatchObject({ status: 'error', attrs: { status: 'failed' } })
      expect(spans(ctx).find((span) => span.name === 'workflow.run')).toMatchObject({ status: 'error', attrs: { status: 'failed' } })
    })
  })

  it('runs with no telemetry at all, because a test builds a runner with no host around it', async () => {
    await withProfile(async () => {
      const runner = new WorkflowRunner(ctx.storage.open(), { ...baseDeps({} as PluginTelemetry), telemetry: undefined }, noExtensions)
      const runId = await runner.start('task-1', { name: 'W', steps: [{ name: 'one', kind: 'agent', prompt: 'go' }] })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
      expect(spans(ctx)).toEqual([])
    })
  })
})
