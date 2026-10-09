import { createRoot } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import type { Project, Task } from '@acorn/protocol/api.ts'

const mocks = vi.hoisted(() => ({ createTask: vi.fn(), readJson: vi.fn(), invalidate: vi.fn(), navigate: vi.fn(), close: vi.fn() }))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }))
vi.mock('../../infra/node/apiClient', () => ({ readJson: mocks.readJson }))
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => null }))
vi.mock('../tasks/taskMutations', () => ({ createTask: mocks.createTask, patchTask: vi.fn() }))
vi.mock('../tasks/activate', () => ({ activateTaskSignals: vi.fn(), pathForTask: (task: Task) => `/tasks/${task.id}` }))
vi.mock('../../kit/components/inputs/IconPicker', () => ({ randomIconName: () => 'sparkles' }))

import { createTaskDraftStore } from './taskDraftStore'

afterEach(() => vi.clearAllMocks())

it('retains the created task and retries a failed follow-on action on that task', async () => {
  const task = { id: 'task-1', title: 'Review', projectId: 'project' } as Task
  const project = { id: 'project', name: 'Project', vcs: 'git' } as Project
  mocks.createTask.mockResolvedValue(task)
  mocks.readJson.mockImplementation((path: string) => {
    if (path.endsWith('/config')) return Promise.resolve({ config: { branchPrefix: null } })
    if (path.endsWith('/branches')) return Promise.resolve({ current: 'main', tasks: [], other: [] })
    if (path.endsWith('/worktrees')) return Promise.resolve([])
    return Promise.resolve({ available: true, branch: 'review' })
  })
  const action = vi.fn().mockRejectedValueOnce(new Error('Run refused')).mockResolvedValue(undefined)
  let dispose!: () => void
  const model = createRoot((release) => {
    dispose = release
    return createTaskDraftStore({ mode: 'new', nodeId: null, projects: [project], projectId: project.id,
      title: 'Review', baseCommit: 'a'.repeat(40) }, () => [], mocks.close, mocks.navigate, action)
  })
  try {
    await vi.waitFor(() => expect(model.canSubmit()).toBe(true))
    await model.submit()
    expect(model.error()).toBe('Run refused')
    expect(model.createdTask()?.id).toBe(task.id)
    expect(mocks.createTask).toHaveBeenCalledOnce()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ baseCommit: 'a'.repeat(40) }), null)
    await model.submit()
    expect(action).toHaveBeenCalledTimes(2)
    expect(action).toHaveBeenNthCalledWith(2, task)
    expect(mocks.createTask).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
  } finally { dispose() }
})
