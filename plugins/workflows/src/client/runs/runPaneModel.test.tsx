import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import type { WorkflowRunProjection } from '../../shared/api'

// The pane's model under jsdom rather than in bare Node, because everything asserted here is
// reactive: a frame moves a signal and a memo has to see it. The node-environment project resolves
// solid-js to its server build, where a memo computes once and dead (../../../../vitest.shared.ts).

const runsCalls = vi.fn()
const stepsCalls = vi.fn()
let runRows: WorkflowRunProjection[] = []
let stepRows: WorkflowStepRow[] = []

vi.mock('../workflowsClient', () => ({
  workflowApi: {
    runs: async (taskId: string) => {
      runsCalls(taskId)
      return runRows
    },
    steps: async (runId: string) => {
      stepsCalls(runId)
      return stepRows.filter((step) => step.runId === runId)
    },
    gate: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    kill: async () => ({ ok: true }),
    retry: async () => ({ ok: true }),
  },
}))

type StepChanged = (frame: { runId: string; stepId: string; status: string }) => void
type StepEvent = (frame: { runId: string; stepId: string; event: unknown }) => void

let onStepChanged: StepChanged | undefined
let onStepEvent: StepEvent | undefined
let onRunChanged: ((payload: unknown) => void) | undefined
let onChildChanged: ((payload: unknown) => void) | undefined
let onReconnect: (() => void) | undefined

vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsOnWorkflowStepChanged: (cb: StepChanged) => {
    onStepChanged = cb
    return () => { onStepChanged = undefined }
  },
  wsOnWorkflowStepEvent: (cb: StepEvent) => {
    onStepEvent = cb
    return () => { onStepEvent = undefined }
  },
  onPluginFrame: (_plugin: string, channel: string, cb: (payload: unknown) => void) => {
    if (channel.endsWith(':run-changed')) onRunChanged = cb
    if (channel.endsWith(':child-changed')) onChildChanged = cb
    return () => {
      if (onRunChanged === cb) onRunChanged = undefined
      if (onChildChanged === cb) onChildChanged = undefined
    }
  },
  wsOnReconnect: (cb: () => void) => {
    onReconnect = cb
    return () => { if (onReconnect === cb) onReconnect = undefined }
  },
}))

const { openPane } = await import('@acorn/plugin-api/client')
const { createRunPaneModel } = await import('./runPaneModel')

const run = (over: Partial<WorkflowRunProjection>): WorkflowRunProjection => ({
  id: 'run-1', taskId: 'task-1', name: 'Investigate an issue', status: 'running', posture: 'gated',
  error: null, createdAt: 200, updatedAt: 200,
  rootRunId: 'run-1', parentRunId: null, parentStepId: null, rootTaskId: 'task-1',
  rootRunName: 'Investigate an issue', parentTaskId: null, parentRunName: null, depth: 0, usage: null,
  defJson: JSON.stringify({ name: 'Investigate an issue', steps: [{ name: 'reproduce', after: [] }, { name: 'synthesise', after: ['reproduce'] }] }),
  ...over,
})

const step = (over: Partial<WorkflowStepRow>): WorkflowStepRow => ({
  id: 'st1', runId: 'run-1', idx: 0, name: 'reproduce', kind: 'agent', mode: 'headless',
  profileId: 'claude-code', model: null, status: 'running', resultJson: null, structuredJson: null,
  sessionId: null, agentSessionId: null, costUsd: null, iteration: 0, error: null,
  createdAt: 10, updatedAt: 20, ...over,
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let dispose: (() => void) | undefined

const mount = async () => {
  let model!: ReturnType<typeof createRunPaneModel>
  createRoot((disposeRoot) => {
    dispose = disposeRoot
    model = createRunPaneModel({ id: 'task-1' } as never)
  })
  await settle()
  return model
}

beforeEach(() => {
  runsCalls.mockClear()
  stepsCalls.mockClear()
  runRows = [run({})]
  stepRows = [step({}), step({ id: 'st2', idx: 1, name: 'synthesise', status: 'pending' })]
})

afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('the run pane model', () => {
  it('lands on the newest run and orders its nodes the way the editor does', async () => {
    const model = await mount()
    expect(model.selectedRunId()).toBe('run-1')
    expect(model.nodes().map((node) => [node.name, node.depth])).toEqual([['reproduce', 0], ['synthesise', 1]])
    // The blocked-then-running rule: nothing is gated, so the running node is what opens.
    expect(model.selectedStepId()).toBe('st1')
  })

  it('moves one node on a step-changed frame and reads nothing', async () => {
    const model = await mount()
    const before = stepsCalls.mock.calls.length
    onStepChanged?.({ runId: 'run-1', stepId: 'st1', status: 'done' })
    expect(model.steps().find((row) => row.id === 'st1')?.status).toBe('done')
    expect(stepsCalls.mock.calls.length).toBe(before)
  })

  it('ignores a step-changed frame for another run', async () => {
    const model = await mount()
    onStepChanged?.({ runId: 'run-9', stepId: 'st1', status: 'failed' })
    expect(model.steps().find((row) => row.id === 'st1')?.status).toBe('running')
  })

  it('re-reads the run and its steps when a run begins or ends', async () => {
    const model = await mount()
    const before = stepsCalls.mock.calls.length
    stepRows = [step({ status: 'done' }), step({ id: 'st2', idx: 1, name: 'synthesise', status: 'running' })]
    onRunChanged?.({ taskId: 'task-1', runId: 'run-1' })
    await settle()
    expect(stepsCalls.mock.calls.length).toBeGreaterThan(before)
    expect(model.steps().find((row) => row.id === 'st2')?.status).toBe('running')
  })

  it('re-reads parent child summaries on a child change and after reconnect', async () => {
    await mount()
    const before = stepsCalls.mock.calls.length
    onChildChanged?.({ ownerTaskId: 'task-1', taskId: 'child-task', parentRunId: 'run-1', runId: 'child-run' })
    await settle()
    expect(stepsCalls.mock.calls.length).toBeGreaterThan(before)

    const afterChild = stepsCalls.mock.calls.length
    onReconnect?.()
    await settle()
    expect(stepsCalls.mock.calls.length).toBeGreaterThan(afterChild)
  })

  it('keeps only the last few kilobytes of a command tail', async () => {
    const model = await mount()
    for (let at = 0; at < 20; at++) onStepEvent?.({ runId: 'run-1', stepId: 'st1', event: { type: 'stdout', text: 'x'.repeat(500) } })
    const tail = model.tailFor('st1').join('\n')
    expect(tail.length).toBe(4000)
    // The event ring is separate from the tail and keeps its cap too.
    expect(model.eventsFor('st1')).toHaveLength(20)
  })

  it('keeps an event it does not recognise', async () => {
    const model = await mount()
    onStepEvent?.({ runId: 'run-1', stepId: 'st1', event: { type: 'something-else', detail: 1 } })
    expect(model.eventsFor('st1')).toEqual([{ type: 'something-else', detail: 1 }])
    expect(model.tailFor('st1')).toEqual([])
  })

  it('follows an intent to a run and a node', async () => {
    runRows = [run({}), run({ id: 'run-0', createdAt: 100, status: 'done' })]
    stepRows = [...stepRows, step({ id: 'st9', runId: 'run-0', name: 'reproduce', status: 'done' })]
    const model = await mount()
    expect(model.selectedRunId()).toBe('run-1')

    openPane('task-1', 'workflows', { kind: 'workflows:show-run', runId: 'run-0', stepId: 'st9' })
    await settle()
    expect(model.selectedRunId()).toBe('run-0')
    expect(model.selectedStepId()).toBe('st9')
  })

  it('takes the deep link plugin:select as a run id', async () => {
    runRows = [run({}), run({ id: 'run-0', createdAt: 100, status: 'done' })]
    const model = await mount()
    openPane('task-1', 'workflows', { kind: 'plugin:select', item: 'run-0' })
    await settle()
    expect(model.selectedRunId()).toBe('run-0')
  })
})
