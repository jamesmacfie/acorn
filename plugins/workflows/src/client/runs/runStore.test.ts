import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ allRuns: vi.fn(), taskNavigation: vi.fn() }))
vi.mock('../workflowsClient', () => ({ workflowApi: api }))

const { taskHasWorkflowRuns, workflowRunCountsSchedule, workflowTaskGroups } = await import('./runStore')

describe('workflow run navigation cache', () => {
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
})
