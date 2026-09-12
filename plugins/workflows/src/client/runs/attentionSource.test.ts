import { describe, expect, it, vi } from 'vitest'
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'

// A gate is a state, not an event: the inbox fetches, so the row for one gate has to come back with
// the same id every time until somebody answers it (client-core registries/rail/attention.ts).

let runs: { id: string; title: string; status: string; taskId: string | null; startedAt: number }[] = []
let steps: WorkflowStepRow[] = []
const stepsFor = vi.fn<(runId: string) => WorkflowStepRow[]>()

vi.mock('../workflowsClient', () => ({
  workflowApi: {
    allRuns: async () => ({ runs }),
    steps: async (runId: string) => stepsFor(runId),
  },
}))

const { workflowsAttentionSource } = await import('./attentionSource')

const step = (over: Partial<WorkflowStepRow>): WorkflowStepRow => ({
  id: 'st1', runId: 'run-1', idx: 0, name: 'review', kind: 'gate-human', mode: 'headless',
  profileId: null, model: null, status: 'waiting-gate', resultJson: null, structuredJson: null,
  sessionId: null, agentSessionId: null, costUsd: null, iteration: 0, error: null,
  createdAt: 10, updatedAt: 20, ...over,
})

const fetchRows = () => workflowsAttentionSource.fetch('node-1', new AbortController().signal)

describe('the gate attention source', () => {
  it('gives one row per waiting gate, with an id that survives a refetch', async () => {
    runs = [{ id: 'run-1', title: 'Investigate an issue', status: 'waiting', taskId: 'task-1', startedAt: 1 }]
    steps = [step({}), step({ id: 'st2', name: 'ship', status: 'done' })]
    stepsFor.mockImplementation(() => steps)

    const first = await fetchRows()
    expect(first).toHaveLength(1)
    expect(first[0].id).toBe('workflow:gate:st1')
    expect(first[0].taskId).toBe('task-1')
    expect(first[0].severity).toBe('warn')
    // `at` is when the wait began, not when the inbox asked, so the row can say how long it has been
    // sitting there — and so the id below stays free of a timestamp.
    expect(first[0].at).toBe(20)
    expect(first[0].target).toEqual({ kind: 'workflow-run', resourceId: 'run-1', subresourceId: 'st1' })

    const second = await fetchRows()
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id))
  })

  it('drops the row once the gate is answered', async () => {
    runs = [{ id: 'run-1', title: 'Investigate an issue', status: 'done', taskId: 'task-1', startedAt: 1 }]
    steps = [step({ status: 'done' })]
    stepsFor.mockImplementation(() => steps)
    expect(await fetchRows()).toEqual([])
  })

  it('reads no steps for a run that is not waiting', async () => {
    runs = [{ id: 'run-1', title: 'Investigate an issue', status: 'running', taskId: 'task-1', startedAt: 1 }]
    stepsFor.mockClear()
    expect(await fetchRows()).toEqual([])
    expect(stepsFor).not.toHaveBeenCalled()
  })
})
