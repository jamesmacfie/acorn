import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'

const calls = vi.hoisted(() => ({ defsList: vi.fn(), start: vi.fn(), navigate: vi.fn(), close: vi.fn(), openRun: vi.fn() }))
const task = { id: 'created-task', title: 'Review', projectId: 'project' } as Task
let created: (() => Promise<void>) | undefined
let savedTask: Task | null = null
vi.mock('@solidjs/router', () => ({ useNavigate: () => calls.navigate }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: (options: () => { queryKey: string[] }) => ({
  get data() { return options().queryKey[0] === 'projects' ? [{ id: 'project', name: 'Project', vcs: 'git' }] : options().queryKey[0] === 'workspaces' ? [{ id: 'workspace', projects: [{ id: 'project' }] }] : [] },
}) }))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => null,
  projectsOptions: () => ({ queryKey: ['projects'] }), tasksOptions: () => ({ queryKey: ['tasks'] }),
  workspacesOptions: () => ({ queryKey: ['workspaces'] }), workspaceForProject: (rows: unknown[]) => rows[0],
}))
vi.mock('@acorn/plugin-api/client/task-draft', () => ({
  createTaskDraftStore: (_draft: unknown, _tasks: unknown, close: () => void, _navigate: unknown, onCreated: (task: Task) => Promise<void>, existing?: Task) => {
    const [error, setError] = createSignal('')
    const [current, setCurrent] = createSignal<Task | null>(existing ?? null)
    created = async () => {
      setCurrent(task); savedTask = task
      try { await onCreated(task); close() } catch (cause) { setError((cause as Error).message) }
    }
    return { text: () => 'Review', setText: vi.fn(), branchTouched: () => false, branchText: () => '',
      effectiveBranch: () => 'review', checkedAvailability: () => ({ available: true }), setBranch: vi.fn(),
      branchError: () => '', skipSetup: () => false, setSkipSetup: vi.fn(), error, createdTask: current,
      saving: () => false, canSubmit: () => true, submit: created, openCreatedTask: vi.fn() }
  },
}))
vi.mock('./workflowsClient', () => ({ workflowApi: { defsList: calls.defsList } }))
vi.mock('./startWorkflow', () => ({ startWorkflow: calls.start }))
vi.mock('./runs/runStore', () => ({ openWorkflowRun: calls.openRun }))

import GitLaunchDialog from './GitLaunchDialog'

let host: HTMLElement | undefined
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); host?.remove(); host = undefined; dispose = undefined; savedTask = null; created = undefined; vi.resetAllMocks() })

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
  expect(calls.start).toHaveBeenCalledWith(task.id, { defId: 'review' }, { reason: 'Because' }, expect.any(Function))
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click()
  dispose(); host.innerHTML = ''
  dispose = render(() => <GitLaunchDialog request={{ nodeId: null, projectId: 'project', commitId: 'a'.repeat(40), title: 'Review' }} onClose={calls.close} />, host)
  await vi.waitFor(() => expect(document.body.textContent).toContain('Retry workflow'))
  expect((document.body.querySelector('input') as HTMLInputElement).value).toBe('Because')
  run().click()
  await vi.waitFor(() => expect(calls.start).toHaveBeenCalledTimes(2))
  expect(calls.start).toHaveBeenNthCalledWith(2, task.id, { defId: 'review' }, { reason: 'Because' }, expect.any(Function))
  expect(calls.openRun).toHaveBeenCalledWith(task, 'run-1', calls.navigate)
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
