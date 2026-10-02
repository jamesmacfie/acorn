import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ allRuns: vi.fn(), taskNavigation: vi.fn() }))
vi.mock('../workflowsClient', () => ({ createWorkflowApi: () => api }))

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

it('joins held navigation waves and still reads a follow-up after invalidation', async () => {
  let finish!: (value: { runs: { taskId: string }[] }) => void
  api.allRuns.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ runs: [{ taskId: 'after-wave' }] })
  api.taskNavigation.mockResolvedValue({ groups: [] })
  const before = api.allRuns.mock.calls.length
  const reads = Array.from({ length: 30 }, () => workflowRunCountsSchedule.run())
  expect(api.allRuns.mock.calls.length - before).toBe(1)
  finish({ runs: [] }); await Promise.all(reads)
  expect(api.allRuns.mock.calls.length - before).toBe(2)
  expect(taskHasWorkflowRuns('after-wave')).toBe(true)
})

it('does not publish a disposed read and does not cancel a surviving schedule owner', async () => {
  let finish!: (value: { runs: { taskId: string }[] }) => void
  const first = workflowRunCountsSchedule.subscribe!(() => {})
  const second = workflowRunCountsSchedule.subscribe!(() => {})
  api.allRuns.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  api.taskNavigation.mockResolvedValue({ groups: [] })
  const surviving = workflowRunCountsSchedule.run()
  first(); finish({ runs: [{ taskId: 'survivor' }] }); await surviving
  expect(taskHasWorkflowRuns('survivor')).toBe(true)

  api.allRuns.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const departed = workflowRunCountsSchedule.run()
  second(); finish({ runs: [{ taskId: 'obsolete' }] }); await departed
  expect(taskHasWorkflowRuns('obsolete')).toBe(false)
})
