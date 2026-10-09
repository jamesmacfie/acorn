import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'

const calls = vi.hoisted(() => ({ defsList: vi.fn(), start: vi.fn(), navigate: vi.fn(), close: vi.fn(), openRun: vi.fn(),
  pathname: '/p/project/x/git/history', nodeId: null as string | null, readNodes: [] as Array<string | null>, apiNodes: [] as Array<string | null> }))
const task = { id: 'created-task', title: 'Review', projectId: 'project' } as Task
let nextTask = task
let createGate: Promise<void> | undefined
let created: (() => Promise<void>) | undefined
let savedTask: Task | null = null
vi.mock('@solidjs/router', () => ({ useNavigate: () => calls.navigate, useLocation: () => ({ get pathname() { return calls.pathname } }) }))
vi.mock('@acorn/plugin-api/client', () => ({
  clientCapabilityId: (id: string) => id,
  activeNodeId: () => calls.nodeId,
  readJson: async (path: string, options: { nodeId: string | null }) => {
    calls.readNodes.push(options.nodeId)
    return path.endsWith('/projects') ? { projects: [{ id: 'project', name: 'Project', vcs: 'git' }] }
      : path.endsWith('/workspaces') ? [{ id: 'workspace', projects: [{ id: 'project' }] }] : []
  },
  workspaceForProject: (rows: unknown[]) => rows[0],
}))
vi.mock('@acorn/plugin-api/client/task-draft', () => ({
  createTaskDraftStore: (_draft: unknown, _tasks: unknown, close: () => void, _navigate: unknown, onCreated: (task: Task) => Promise<void>,
    existing?: () => Task | null, onPersisted?: (task: Task) => void) => {
    const [error, setError] = createSignal('')
    const [current, setCurrent] = createSignal<Task | null>(existing?.() ?? null)
    created = async () => {
      await createGate
      setCurrent(nextTask); savedTask = nextTask; onPersisted?.(nextTask)
      try { await onCreated(nextTask); close() } catch (cause) { setError((cause as Error).message) }
    }
    return { text: () => 'Review', setText: vi.fn(), branchTouched: () => false, branchText: () => '',
      effectiveBranch: () => 'review', checkedAvailability: () => ({ available: true }), setBranch: vi.fn(),
      branchError: () => '', skipSetup: () => false, setSkipSetup: vi.fn(), error, createdTask: current,
      saving: () => false, canSubmit: () => true, submit: created, openCreatedTask: vi.fn() }
  },
}))
vi.mock('./workflowsClient', () => ({ workflowApiForNode: (nodeId: string | null) => {
  calls.apiNodes.push(nodeId)
  return { defsList: calls.defsList }
} }))
vi.mock('./startWorkflow', () => ({ startWorkflow: calls.start }))
vi.mock('./runs/runStore', () => ({ openWorkflowRun: calls.openRun }))

import GitLaunchDialog from './GitLaunchDialog'
import { openWorkflowGitLaunch, workflowGitLaunchRequest, closeWorkflowGitLaunch } from '../contract/gitLaunch.ts'

let host: HTMLElement | undefined
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); host?.remove(); host = undefined; dispose = undefined; savedTask = null; created = undefined;
  nextTask = task; createGate = undefined;
  calls.pathname = '/p/project/x/git/history'; calls.nodeId = null; calls.readNodes.length = 0; calls.apiNodes.length = 0;
  closeWorkflowGitLaunch(); vi.resetAllMocks() })

it('requires workflow input and retries a refused start on the created task', async () => {
  calls.defsList.mockResolvedValue({ workflows: [{ id: 'review', name: 'Review', source: 'database', publishedRevision: 1,
    baseline: 'acorn-1', formatVersion: 1, inputs: [{ name: 'reason', required: true }], steps: [] }], errors: [] })
  calls.start.mockResolvedValueOnce({ error: 'Run refused' }).mockResolvedValueOnce({ runId: 'run-1' })
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={{ nodeId: null, projectId: 'project', commitId: 'a'.repeat(40), title: 'Review' }} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  const run = () => Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes(savedTask ? 'Retry workflow' : 'Create task and run'))!
  expect(run().disabled).toBe(true)
  const input = document.body.querySelector('input') as HTMLInputElement
  input.value = 'Because'
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await vi.waitFor(() => expect(run().disabled).toBe(false))
  run().click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('Run refused'))
  expect(calls.start).toHaveBeenCalledWith(task.id, { defId: 'review' }, { reason: 'Because' }, expect.any(Function), expect.any(String), expect.any(Object))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click()
  dispose(); host.innerHTML = ''
  dispose = render(() => <GitLaunchDialog request={{ nodeId: null, projectId: 'project', commitId: 'a'.repeat(40), title: 'Review' }} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Retry workflow'))
  expect((document.body.querySelector('input') as HTMLInputElement).value).toBe('Because')
  run().click()
  await vi.waitFor(() => expect(calls.start).toHaveBeenCalledTimes(2))
  expect(calls.start).toHaveBeenNthCalledWith(2, task.id, { defId: 'review' }, { reason: 'Because' }, expect.any(Function), expect.any(String), expect.any(Object))
  expect(calls.openRun).toHaveBeenCalledWith(task, 'run-1', calls.navigate)
})

it('freezes workflow and inputs before a delayed task creation resolves, then reuses that invocation', async () => {
  let finishTask!: () => void
  createGate = new Promise<void>((resolve) => { finishTask = resolve })
  calls.defsList.mockResolvedValue({ workflows: [
    { id: 'review', name: 'Review', source: 'database', publishedRevision: 1, inputs: [{ name: 'reason', required: true }], steps: [] },
    { id: 'other', name: 'Other', source: 'database', publishedRevision: 1, inputs: [{ name: 'reason', required: true }], steps: [] },
  ], errors: [] })
  calls.start.mockResolvedValueOnce({ error: 'response lost' }).mockResolvedValueOnce({ runId: 'same-run' })
  const request = { nodeId: null, projectId: 'project', commitId: '2'.repeat(40), title: 'Review' }
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={request} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  const reason = document.body.querySelector('input') as HTMLInputElement
  reason.value = 'Original'; reason.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await vi.waitFor(() => expect(Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')?.disabled).toBe(false))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')!.click()
  const select = document.body.querySelector('select')!
  select.value = 'other'; select.dispatchEvent(new Event('change', { bubbles: true }))
  reason.value = 'Changed'; reason.dispatchEvent(new InputEvent('input', { bubbles: true }))
  finishTask()
  await vi.waitFor(() => expect(calls.start).toHaveBeenCalledOnce())
  expect(calls.start).toHaveBeenCalledWith(task.id, { defId: 'review' }, { reason: 'Original' }, expect.any(Function), expect.any(String), expect.any(Object))
  const firstId = calls.start.mock.calls[0]![4]
  dispose(); host.innerHTML = ''
  dispose = render(() => <GitLaunchDialog request={request} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Retry workflow'))
  expect((document.body.querySelector('input') as HTMLInputElement).value).toBe('Original')
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Retry workflow')!.click()
  await vi.waitFor(() => expect(calls.start).toHaveBeenCalledTimes(2))
  expect(calls.start.mock.calls[1]!.slice(0, 5)).toEqual([task.id, { defId: 'review' }, { reason: 'Original' }, expect.any(Function), firstId])
})

it('retires a completed launch after navigation so the same commit can start again', async () => {
  calls.defsList.mockResolvedValue({ workflows: [{ id: 'review', name: 'Review', source: 'database', publishedRevision: 1,
    inputs: [], steps: [] }], errors: [] })
  calls.start.mockResolvedValueOnce({ runId: 'first-run' }).mockResolvedValueOnce({ runId: 'second-run' })
  const request = { nodeId: null, projectId: 'project', commitId: '3'.repeat(40), title: 'Review' }
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={request} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')!.click()
  await vi.waitFor(() => expect(calls.openRun).toHaveBeenCalledWith(task, 'first-run', calls.navigate))
  const firstId = calls.start.mock.calls[0]![4]
  dispose(); host.innerHTML = ''
  nextTask = { ...task, id: 'second-task' }
  dispose = render(() => <GitLaunchDialog request={request} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  expect(document.body.textContent).not.toContain('Open run')
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')!.click()
  await vi.waitFor(() => expect(calls.openRun).toHaveBeenCalledWith(nextTask, 'second-run', calls.navigate))
  expect(calls.start.mock.calls[1]![0]).toBe('second-task')
  expect(calls.start.mock.calls[1]![4]).not.toBe(firstId)
})

it('opens the trusted run when the trust prompt completes without a second start', async () => {
  calls.defsList.mockResolvedValue({ workflows: [{ id: 'review', name: 'Review', source: 'database', publishedRevision: 1,
    baseline: 'acorn-1', formatVersion: 1, inputs: [], steps: [] }], errors: [] })
  calls.start.mockImplementationOnce(async (_taskId: string, _body: unknown, _inputs: unknown, onTrusted: (runId: string) => void) => {
    queueMicrotask(() => onTrusted('trusted-run'))
    return { error: 'needs-trust' }
  })
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={{ nodeId: null, projectId: 'project', commitId: 'b'.repeat(40), title: 'Review' }} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')!.click()
  await vi.waitFor(() => expect(calls.openRun).toHaveBeenCalledWith(task, 'trusted-run', calls.navigate))
  expect(calls.start).toHaveBeenCalledOnce()
  expect(calls.close).toHaveBeenCalled()
})

it('records a delayed run after project navigation without closing or navigating, then reopens it', async () => {
  let finish!: (answer: { runId: string }) => void
  calls.defsList.mockResolvedValue({ workflows: [{ id: 'review', name: 'Review', source: 'database', publishedRevision: 1,
    baseline: 'acorn-1', formatVersion: 1, inputs: [], steps: [] }], errors: [] })
  calls.start.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const request = { nodeId: null, projectId: 'project', commitId: 'c'.repeat(40), title: 'Review' }
  openWorkflowGitLaunch(request)
  const openedRequest = workflowGitLaunchRequest()!
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={openedRequest} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')!.click()
  await vi.waitFor(() => expect(calls.start).toHaveBeenCalledOnce())
  calls.pathname = '/p/another/x/git/history'
  finish({ runId: 'late-run' })
  await vi.waitFor(() => expect(document.body.textContent).toContain('Open run'))
  expect(calls.close).not.toHaveBeenCalled()
  expect(calls.openRun).not.toHaveBeenCalled()
  expect(calls.readNodes.every((nodeId) => nodeId === null)).toBe(true)
  expect(calls.apiNodes).toEqual([null])
  dispose(); host.innerHTML = ''
  calls.pathname = '/p/project/x/git/history'
  openWorkflowGitLaunch(request)
  const reopenedRequest = workflowGitLaunchRequest()!
  dispose = render(() => <GitLaunchDialog request={reopenedRequest} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Open run'))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Open run')!.click()
  expect(calls.openRun).toHaveBeenCalledWith(task, 'late-run', calls.navigate)
  expect(calls.start).toHaveBeenCalledOnce()
})

it('keeps a pending workflow response on the original Node after a Node switch', async () => {
  let finish!: (answer: { runId: string }) => void
  calls.defsList.mockResolvedValue({ workflows: [{ id: 'review', name: 'Review', source: 'database', publishedRevision: 1,
    baseline: 'acorn-1', formatVersion: 1, inputs: [], steps: [] }], errors: [] })
  calls.start.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={{ nodeId: null, projectId: 'project', commitId: '9'.repeat(40), title: 'Review' }} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')!.click()
  await vi.waitFor(() => expect(calls.start).toHaveBeenCalledOnce())
  calls.nodeId = 'another-node'
  finish({ runId: 'old-node-run' })
  await vi.waitFor(() => expect(document.body.textContent).toContain('Open run'))
  expect(calls.openRun).not.toHaveBeenCalled()
  expect(calls.close).not.toHaveBeenCalled()
  expect(calls.apiNodes).toEqual([null])
})

it('retains trust completion after dismissal and replacement without closing the replacement', async () => {
  let approve!: (runId: string) => void
  calls.defsList.mockResolvedValue({ workflows: [{ id: 'review', name: 'Review', source: 'database', publishedRevision: 1,
    baseline: 'acorn-1', formatVersion: 1, inputs: [], steps: [] }], errors: [] })
  calls.start.mockImplementationOnce(async (_taskId: string, _body: unknown, _inputs: unknown, onTrusted: (runId: string) => void) => {
    approve = onTrusted
    return { error: 'needs-trust' }
  })
  openWorkflowGitLaunch({ nodeId: null, projectId: 'project', commitId: 'd'.repeat(40), title: 'Review' })
  const originalRequest = workflowGitLaunchRequest()!
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={originalRequest} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Create task and run'))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Create task and run')!.click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('needs-trust'))
  openWorkflowGitLaunch({ nodeId: null, projectId: 'project', commitId: 'e'.repeat(40), title: 'Other launch' })
  approve('trusted-after-replacement')
  expect(calls.close).not.toHaveBeenCalled()
  expect(calls.openRun).not.toHaveBeenCalled()
  dispose(); host.innerHTML = ''
  openWorkflowGitLaunch({ nodeId: null, projectId: 'project', commitId: 'd'.repeat(40), title: 'Review' })
  const recoveredRequest = workflowGitLaunchRequest()!
  dispose = render(() => <GitLaunchDialog request={recoveredRequest} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Open run'))
  expect(calls.start).toHaveBeenCalledOnce()
})

it('shows definition load failure and retries without leaving an empty overlay', async () => {
  calls.defsList.mockRejectedValueOnce(new Error('Definitions offline')).mockResolvedValueOnce({ workflows: [], errors: [] })
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <GitLaunchDialog request={{ nodeId: null, projectId: 'project', commitId: 'f'.repeat(40), title: 'Review' }} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Definitions offline'))
  expect(document.body.textContent).toContain('Retry loading')
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Retry loading')!.click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('No runnable workflows'))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click()
  expect(calls.close).toHaveBeenCalledOnce()
})
