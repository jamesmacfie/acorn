import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import type { WorkflowDefSummary } from '../contract/wire'

const calls = vi.hoisted(() => ({
  navigate: vi.fn(), invalidate: vi.fn(), activate: vi.fn(), start: vi.fn(),
  defsList: vi.fn(), toast: vi.fn(),
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
  activeNodeId: () => null,
  activateTaskSignals: calls.activate,
  pathForTask: (task: Task) => `/t/${task.id}`,
  tasksKey: ['tasks'],
  tasksOptions: () => ({ queryKey: ['tasks'] }),
  toast: calls.toast,
  workspaceForProject: (workspaces: { id: string }[]) => workspaces[0],
  workspacesOptions: () => ({ queryKey: ['workspaces'] }),
}))
vi.mock('./workflowsClient', () => ({
  workflowApi: {
    defsList: calls.defsList,
    start: calls.start,
  },
}))

type ModalProps = {
  action: { onTaskReady: (task: Task) => Promise<void>; content: import('solid-js').JSX.Element }
  onCreated: (task: Task) => void
  onAttached: (task: Task) => void
}
let modal: ModalProps | undefined
vi.mock('@acorn/plugin-api/ui/host', () => ({
  PromoteToTaskModal: (props: ModalProps) => { modal = props; return props.action.content },
}))

import StartFromItemHost from './StartFromItemHost'
import { closeStartFromItem, openStartFromItem } from './startFromItem'
import { taskHasWorkflowRuns } from './runs/runStore'

let host: HTMLElement | undefined
let dispose: (() => void) | undefined

const definition = (id: string, source: WorkflowDefSummary['source'], publishedRevision?: number | null): WorkflowDefSummary => ({
  id, name: id, source, publishedRevision, baseline: 'acorn-1', formatVersion: 1, inputs: [], steps: [],
})

function open(workflows = [definition('review', 'database', 1)]) {
  calls.defsList.mockResolvedValue({ workflows, errors: [] })
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <StartFromItemHost />, host!)
  openStartFromItem({
    location: 'item.row', id: 'pull-1', title: 'Review PR', providerId: 'github',
    projectId: 'project-1', item: { number: 1 },
  })
}

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
  it('offers published database workflows and file workflows, excluding unpublished and broken definitions', async () => {
    calls.start.mockResolvedValue({ runId: 'run-1' })
    open([
      definition('draft', 'database', null),
      definition('unspecified', 'database'),
      definition('published', 'database', 2),
      definition('repository', 'repo'),
      definition('personal', 'user'),
      { ...definition('broken', 'database', 1), problems: ['The project was removed.'] },
    ])
    await vi.waitFor(() => expect(modal).toBeDefined())

    expect(Array.from(host!.querySelectorAll('option'), (option) => option.textContent))
      .toEqual(['published', 'repository', 'personal'])
    await modal!.action.onTaskReady({ id: 'task-1' } as Task)
    expect(calls.start).toHaveBeenCalledWith('task-1', { defId: 'published' }, undefined)
  })

  it('closes with publication guidance when only unpublished workflows exist', async () => {
    open([definition('draft', 'database', null)])
    await vi.waitFor(() => expect(calls.toast).toHaveBeenCalledWith(
      'This workspace has no runnable workflows. Create and publish one from the Workflows rail.',
    ))
    expect(modal).toBeUndefined()
  })

  it.each(['onCreated', 'onAttached'] as const)('exposes the workflow pane before %s navigates to the run', async (land) => {
    const task = { id: `pr-${land}`, title: 'Review PR' } as Task
    calls.start.mockResolvedValue({ runId: 'run-1' })
    calls.navigate.mockImplementationOnce(() => expect(taskHasWorkflowRuns(task.id)).toBe(true))
    open()
    await vi.waitFor(() => expect(modal).toBeDefined())

    expect(taskHasWorkflowRuns(task.id)).toBe(false)
    await modal!.action.onTaskReady(task)
    expect(taskHasWorkflowRuns(task.id)).toBe(true)
    modal![land](task)

    expect(taskHasWorkflowRuns(task.id)).toBe(true)
    expect(calls.navigate).toHaveBeenCalledWith(`/t/${task.id}?pane=workflows&item=run-1`)
  })
})
