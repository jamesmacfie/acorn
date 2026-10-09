import { createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import type { Project, Task } from '@acorn/protocol/api.ts'

const mocks = vi.hoisted(() => ({ createTask: vi.fn(), readJson: vi.fn(), invalidate: vi.fn(), navigate: vi.fn(), close: vi.fn(), nodeId: null as string | null }))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }))
vi.mock('../../infra/node/apiClient', () => ({ readJson: mocks.readJson }))
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => mocks.nodeId }))
vi.mock('../tasks/taskMutations', () => ({ createTask: mocks.createTask, patchTask: vi.fn() }))
vi.mock('../tasks/activate', () => ({ activateTaskSignals: vi.fn(), pathForTask: (task: Task) => `/tasks/${task.id}` }))
vi.mock('../../kit/components/inputs/IconPicker', () => ({ randomIconName: () => 'sparkles' }))

import { createTaskDraftStore } from './taskDraftStore'

afterEach(() => { vi.clearAllMocks(); mocks.nodeId = null })

it('retains the created task and retries a failed follow-on action on that task', async () => {
  const task = { id: 'task-1', title: 'Review', projectId: 'project' } as Task
  const project = { id: 'project', name: 'Project', vcs: 'git' } as Project
  let targetIdentity = 'a'.repeat(64)
  mocks.createTask.mockResolvedValue(task)
  mocks.readJson.mockImplementation((path: string) => {
    if (path.endsWith('/config')) return Promise.resolve({ config: { branchPrefix: null } })
    if (path.endsWith('/branches')) return Promise.resolve({ current: 'main', tasks: [], other: [] })
    if (path.endsWith('/worktrees')) return Promise.resolve([])
    return Promise.resolve({ available: true, branch: 'review', targetIdentity })
  })
  const action = vi.fn().mockRejectedValueOnce(new Error('Run refused')).mockResolvedValue(undefined)
  const [recovered, setRecovered] = createSignal<Task | null>(null)
  let observedTarget: string | undefined
  const draft = { mode: 'new' as const, nodeId: null, projects: [project], projectId: project.id,
    title: 'Review', baseCommit: 'a'.repeat(40) }
  let dispose!: () => void
  const model = createRoot((release) => {
    dispose = release
    return createTaskDraftStore(draft, () => [], mocks.close, mocks.navigate, action, recovered, setRecovered,
      (identity) => { observedTarget = identity })
  })
  try {
    await vi.waitFor(() => expect(model.canSubmit()).toBe(true))
    await model.submit()
    expect(model.error()).toBe('Run refused')
    expect(model.createdTask()?.id).toBe(task.id)
    expect(mocks.createTask).toHaveBeenCalledOnce()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ baseCommit: 'a'.repeat(40) }), null)
    dispose()
    targetIdentity = 'b'.repeat(64)
    const reopened = createRoot((release) => { dispose = release; return createTaskDraftStore({ ...draft, targetIdentity: observedTarget },
      () => [], mocks.close, mocks.navigate, action, recovered, setRecovered) })
    await reopened.submit()
    expect(reopened.error()).toContain('repository changed')
    expect(action).toHaveBeenCalledOnce()
    expect(reopened.createdTask()).toBe(task)
    expect(mocks.createTask).toHaveBeenCalledOnce()
    targetIdentity = 'a'.repeat(64)
    await reopened.submit()
    expect(action).toHaveBeenCalledTimes(2)
    expect(action).toHaveBeenNthCalledWith(2, task)
    expect(mocks.createTask).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
  } finally { dispose() }
})

it('records a task returned after dismissal without starting the follow-on action, then reuses it', async () => {
  const task = { id: 'late-task', title: 'Review', projectId: 'project' } as Task
  const project = { id: 'project', name: 'Project', vcs: 'git' } as Project
  let targetIdentity = 'a'.repeat(64)
  mocks.readJson.mockImplementation((path: string) => {
    if (path.endsWith('/config')) return Promise.resolve({ config: { branchPrefix: null } })
    if (path.endsWith('/branches')) return Promise.resolve({ current: 'main', tasks: [], other: [] })
    if (path.endsWith('/worktrees')) return Promise.resolve([])
    return Promise.resolve({ available: true, branch: 'review', targetIdentity })
  })
  let finish!: (task: Task) => void
  mocks.createTask.mockReturnValue(new Promise<Task>((resolve) => { finish = resolve }))
  const [recovered, setRecovered] = createSignal<Task | null>(null)
  let observedTarget: string | undefined
  const follow = vi.fn().mockResolvedValue(undefined)
  const draft = { mode: 'new' as const, nodeId: null, projects: [project], projectId: project.id,
    title: 'Review', baseCommit: 'b'.repeat(40) }
  let dismiss!: () => void
  const first = createRoot((release) => { dismiss = release; return createTaskDraftStore(draft, () => [], mocks.close, mocks.navigate,
    follow, recovered, setRecovered, (identity) => { observedTarget = identity }) })
  await vi.waitFor(() => expect(first.canSubmit()).toBe(true))
  const pending = first.submit()
  dismiss()
  finish(task)
  await pending
  expect(recovered()).toBe(task)
  expect(observedTarget).toBe('a'.repeat(64))
  expect(follow).not.toHaveBeenCalled()
  expect(mocks.createTask).toHaveBeenCalledOnce()

  // A remapped project cannot turn a recovered task into another create request.
  targetIdentity = 'c'.repeat(64)

  let dispose!: () => void
  const reopened = createRoot((release) => { dispose = release; return createTaskDraftStore({ ...draft, targetIdentity: observedTarget }, () => [], mocks.close, mocks.navigate,
    follow, recovered, setRecovered) })
  try {
    await vi.waitFor(() => expect(reopened.canSubmit()).toBe(true))
    expect(reopened.createdTask()).toBe(task)
    await reopened.submit()
    expect(reopened.error()).toContain('repository changed')
    expect(follow).not.toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledOnce()
    targetIdentity = 'a'.repeat(64)
    await reopened.submit()
    expect(follow).toHaveBeenCalledExactlyOnceWith(task)
    expect(mocks.createTask).toHaveBeenCalledOnce()
  } finally { dispose() }
})

it('keeps the first repository observation when availability refreshes after a remap', async () => {
  const project = { id: 'project', name: 'Project', vcs: 'git' } as Project
  let identity = 'a'.repeat(64)
  const [tasks, setTasks] = createSignal<Task[]>([])
  mocks.readJson.mockImplementation((path: string) => {
    if (path.endsWith('/config')) return Promise.resolve({ config: { branchPrefix: null } })
    if (path.endsWith('/branches')) return Promise.resolve({ current: 'main', tasks: [], other: [] })
    if (path.endsWith('/worktrees')) return Promise.resolve([])
    return Promise.resolve({ available: true, branch: 'review', targetIdentity: identity })
  })
  let dispose!: () => void
  const model = createRoot((release) => { dispose = release; return createTaskDraftStore({ mode: 'new', nodeId: null,
    projects: [project], projectId: 'project', title: 'Review', baseCommit: 'b'.repeat(40) }, tasks, mocks.close, mocks.navigate) })
  try {
    await vi.waitFor(() => expect(model.canSubmit()).toBe(true))
    identity = 'c'.repeat(64)
    setTasks([{ id: 'other-task' } as Task])
    await vi.waitFor(() => expect(model.branchError()).toContain('repository changed'))
    expect(model.canSubmit()).toBe(false)
    expect(mocks.createTask).not.toHaveBeenCalled()
  } finally { dispose() }
})
