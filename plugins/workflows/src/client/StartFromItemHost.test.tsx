import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'

const calls = vi.hoisted(() => ({
  navigate: vi.fn(), invalidate: vi.fn(), activate: vi.fn(), start: vi.fn(),
}))

vi.mock('@solidjs/router', () => ({ useNavigate: () => calls.navigate }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: string[] }) => ({
    get data() {
      return options().queryKey[0] === 'tasks'
        ? []
        : [{ id: 'workspace-1', projects: [{ id: 'project-1' }] }]
    },
  }),
  useQueryClient: () => ({ invalidateQueries: calls.invalidate }),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activateTaskSignals: calls.activate,
  pathForTask: (task: Task) => `/t/${task.id}`,
  tasksKey: ['tasks'],
  tasksOptions: () => ({ queryKey: ['tasks'] }),
  toast: vi.fn(),
  workspaceForProject: (workspaces: { id: string }[]) => workspaces[0],
  workspacesOptions: () => ({ queryKey: ['workspaces'] }),
}))
vi.mock('@acorn/plugin-api/ui', () => ({ Field: () => null, Input: () => null, Select: () => null }))
vi.mock('./workflowsClient', () => ({
  workflowApi: {
    defsList: async () => ({ workflows: [{ id: 'review', name: 'Review', inputs: [] }] }),
    start: calls.start,
  },
}))

type ModalProps = {
  action: { onTaskReady: (task: Task) => Promise<void> }
  onCreated: (task: Task) => void
  onAttached: (task: Task) => void
}
let modal: ModalProps | undefined
vi.mock('@acorn/plugin-api/ui/host', () => ({
  PromoteToTaskModal: (props: ModalProps) => { modal = props; return null },
}))

import StartFromItemHost from './StartFromItemHost'
import { closeStartFromItem, openStartFromItem } from './startFromItem'
import { taskHasWorkflowRuns } from './runs/runStore'

let host: HTMLElement | undefined
let dispose: (() => void) | undefined

afterEach(() => {
  closeStartFromItem()
  dispose?.()
  host?.remove()
  host = undefined
  dispose = undefined
  modal = undefined
  vi.clearAllMocks()
})

describe('starting a workflow from an integration row', () => {
  it.each(['onCreated', 'onAttached'] as const)('exposes the workflow pane before %s navigates to the run', async (land) => {
    const task = { id: `pr-${land}`, title: 'Review PR' } as Task
    calls.start.mockResolvedValue({ runId: 'run-1' })
    calls.navigate.mockImplementationOnce(() => expect(taskHasWorkflowRuns(task.id)).toBe(true))
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => <StartFromItemHost />, host)
    openStartFromItem({
      location: 'item.row', id: 'pull-1', title: 'Review PR', providerId: 'github',
      projectId: 'project-1', item: { number: 1 },
    })
    await vi.waitFor(() => expect(modal).toBeDefined())

    expect(taskHasWorkflowRuns(task.id)).toBe(false)
    await modal!.action.onTaskReady(task)
    expect(taskHasWorkflowRuns(task.id)).toBe(true)
    modal![land](task)

    expect(taskHasWorkflowRuns(task.id)).toBe(true)
    expect(calls.navigate).toHaveBeenCalledWith(`/t/${task.id}?pane=workflows&item=run-1`)
  })
})
