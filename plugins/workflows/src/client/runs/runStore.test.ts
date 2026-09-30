import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ allRuns: vi.fn(), taskNavigation: vi.fn() }))
vi.mock('../workflowsClient', () => ({ workflowApi: api }))

const { rememberWorkflowRun, taskHasWorkflowRuns, workflowRunCountsSchedule, workflowTaskGroups } = await import('./runStore')

describe('workflow run navigation cache', () => {
  it('exposes a known run before navigation and lets the next node read reconcile it', async () => {
    expect(taskHasWorkflowRuns('recent-link')).toBe(false)
    rememberWorkflowRun('recent-link')
    expect(taskHasWorkflowRuns('recent-link')).toBe(true)
    expect(taskHasWorkflowRuns('other-task')).toBe(false)

    api.allRuns.mockResolvedValueOnce({ runs: [{ taskId: 'other-task' }] })
    api.taskNavigation.mockResolvedValueOnce({ groups: [] })
    await workflowRunCountsSchedule.run()
    expect(taskHasWorkflowRuns('recent-link')).toBe(false)
    expect(taskHasWorkflowRuns('other-task')).toBe(true)
  })

  it('retains the last known run and group state while the node is unavailable', async () => {
    api.allRuns.mockResolvedValueOnce({ runs: [{ taskId: 'root' }] })
    api.taskNavigation.mockResolvedValueOnce({ groups: [{ rootTaskId: 'root', descendants: 2, running: 1, attention: 1 }] })
    await workflowRunCountsSchedule.run()
    expect(taskHasWorkflowRuns('root')).toBe(true)
    expect(workflowTaskGroups().root).toMatchObject({ running: 1, attention: 1 })

    api.allRuns.mockRejectedValueOnce(new Error('offline'))
    api.taskNavigation.mockRejectedValueOnce(new Error('offline'))
    await workflowRunCountsSchedule.run()
    expect(taskHasWorkflowRuns('root')).toBe(true)
    expect(workflowTaskGroups().root).toMatchObject({ running: 1, attention: 1 })
  })

  it('does not replace a confirmed start with a read sent before that start', async () => {
    let finishRead!: (value: { runs: { taskId: string }[] }) => void
    api.allRuns.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve }))
    api.taskNavigation.mockResolvedValueOnce({ groups: [] })
    const staleRead = workflowRunCountsSchedule.run()

    rememberWorkflowRun('new-confirmed-run')
    finishRead({ runs: [] })
    await staleRead
    expect(taskHasWorkflowRuns('new-confirmed-run')).toBe(true)

    api.allRuns.mockResolvedValueOnce({ runs: [] })
    api.taskNavigation.mockResolvedValueOnce({ groups: [] })
    await workflowRunCountsSchedule.run()
    expect(taskHasWorkflowRuns('new-confirmed-run')).toBe(false)
  })
})
