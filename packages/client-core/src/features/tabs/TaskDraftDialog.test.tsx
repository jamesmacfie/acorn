import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { Project, Task } from '@acorn/protocol/api.ts'

const mocks = vi.hoisted(() => ({ createTask: vi.fn(), invalidate: vi.fn(), navigate: vi.fn() }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }))
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => null }))
vi.mock('../tasks/taskMutations', () => ({ createTask: mocks.createTask, patchTask: vi.fn() }))
vi.mock('../tasks/activate', () => ({ activateTaskSignals: vi.fn(), pathForTask: (task: Task) => `/tasks/${task.id}` }))

import { TaskDraftDialog } from './TaskDraftDialog'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
  vi.resetAllMocks()
})

const task = { id: 'created', title: 'Review', projectId: 'project' } as Task
function mount(onCreated?: (task: Task) => Promise<void>) {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => {
    const [open, setOpen] = createSignal(true)
    return (
      <Show when={open()}>
        <TaskDraftDialog
          draft={{
            mode: 'new',
            nodeId: null,
            projects: [{ id: 'project', name: 'Project', vcs: null } as Project],
            projectId: 'project',
            title: task.title,
          }}
          tasks={() => []}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      </Show>
    )
  }, host)
}
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (element) => element.textContent === label,
  )

it('keeps recovery messages and actions hidden while a successful save refreshes the task list', async () => {
  let finish!: () => void
  mocks.createTask.mockResolvedValue(task)
  mocks.invalidate.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  mount()
  button('Create task')!.click()
  await vi.waitFor(() => expect(mocks.invalidate).toHaveBeenCalled())
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('was created')
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(button('Open task')).toBeUndefined()
  expect(button('Retry workflow')).toBeUndefined()
  finish()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(mocks.navigate).toHaveBeenCalledWith('/tasks/created')
})

it('shows the failure and neutral recovery guidance, then retries on the created task', async () => {
  mocks.createTask.mockResolvedValue(task)
  const follow = vi.fn().mockRejectedValueOnce(new Error('Run refused')).mockResolvedValue(undefined)
  mount(follow)
  button('Create task')!.click()
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe('Run refused'))
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Task Review was created')
  expect(button('Open task')).toBeDefined()
  button('Retry workflow')!.click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(mocks.createTask).toHaveBeenCalledOnce()
  expect(follow).toHaveBeenNthCalledWith(2, task)
})
