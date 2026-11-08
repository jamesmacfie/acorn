import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../infra/node/apiClient'

// Create plugin writes the scaffold, makes the folder a project, opens a task there, and leaves the
// starter prompt unsent in the chosen agent's composer. Try again picks up after the last finished step.
const state = vi.hoisted(() => ({
  local: true,
  mode: 'on' as 'on' | 'off',
  agents: [] as { id: string; label: string }[],
}))
const starter = vi.hoisted(() => ({ choices: vi.fn(), start: vi.fn() }))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly unknown[] }) => ({
    isPending: false,
    isError: false,
    get data() {
      return options().queryKey[0] === 'workspaces'
        ? [{ id: 'ws-1', name: 'Work' }]
        : { sources: [{ pluginId: 'linear', sourceId: 'issues', name: 'Linear issues' }] }
    },
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}))
vi.mock('../../../infra/queries', () => ({
  projectsKey: ['projects'],
  workspacesKey: ['workspaces'],
  tasksOptions: () => ({ queryKey: ['tasks'] }),
  workspacesOptions: () => ({ queryKey: ['workspaces'] }),
}))
vi.mock('../../dataSources/queries', () => ({ dataSourceCatalogOptions: () => ({ queryKey: ['catalog'] }) }))
vi.mock('../../../infra/node/clientCapabilities', async (original) => ({
  ...(await original<typeof import('../../../infra/node/clientCapabilities')>()),
  clientCapability: () => starter,
}))
vi.mock('../../../infra/node/nodePlugins', () => ({ scaffoldNodePlugin: vi.fn() }))
vi.mock('../../workspaces/workspacesMode', () => ({ createWorkspacesMode: () => () => state.mode }))
vi.mock('../../workspaces/activeWorkspaceId', () => ({ createActiveWorkspaceId: () => () => 'ws-1' }))
vi.mock('../../workspaces/addProject', () => ({
  canAddProjectFromFolder: () => state.local,
  pickNodeFolder: vi.fn(),
}))
vi.mock('../../workspaces/workspaceMutations', () => ({ createProject: vi.fn(), createWorkspace: vi.fn() }))
vi.mock('../../tasks/taskMutations', () => ({ createTask: vi.fn() }))
vi.mock('../../tasks/activate', () => ({
  activateTaskSignals: vi.fn(),
  pathForTask: (task: { id: string }) => `/t/${task.id}`,
}))
vi.mock('../../notifications/toast', () => ({ toast: vi.fn() }))

import { CreatePluginDialog } from './CreatePluginDialog'
import { scaffoldNodePlugin } from '../../../infra/node/nodePlugins'
import { createProject } from '../../workspaces/workspaceMutations'
import { createTask } from '../../tasks/taskMutations'
import { activateTaskSignals } from '../../tasks/activate'

let host: HTMLElement
let dispose: (() => void) | undefined
const open = (variant: 'plugin' | 'data-source' = 'plugin') => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => <CreatePluginDialog variant={variant} nodeId="node-a" onClose={() => {}} onOpenAgents={() => {}} />,
    host,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  state.local = true
  state.mode = 'on'
  starter.choices.mockImplementation(async () => state.agents)
  starter.start.mockResolvedValue('session-1')
  state.agents = [
    { id: 'claude', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
  ]
  vi.mocked(scaffoldNodePlugin).mockResolvedValue({ result: 'written', git: 'committed' })
  vi.mocked(createProject).mockResolvedValue({ project: { id: 'project-1' } } as never)
  vi.mocked(createTask).mockResolvedValue({ id: 'task-1' } as never)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const labels = () => [...dialog().querySelectorAll('.ui-field-label')].map((label) => label.textContent)
const button = (text: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === text)
const type = (label: string, value: string) => {
  const field = [...dialog().querySelectorAll('.ui-field-label')].find((entry) => entry.textContent?.startsWith(label))!
  const input = document.getElementById(field.getAttribute('for')!) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
}
const fill = () => {
  type('Project name', 'Hello')
  type('Folder', '/tmp/plugins/hello')
}

describe('CreatePluginDialog', () => {
  it('shows the workspace and agent selects, and Choose… for a local Node', async () => {
    open()
    await vi.waitFor(() => expect(labels()).toContain('Agent'))
    expect(labels()).toContain('Workspace')
    expect(button('Choose…')).toBeDefined()
  })

  it('hides the selects with workspaces off and one agent, and Choose… for a remote Node', async () => {
    state.mode = 'off'
    state.agents = [{ id: 'claude', label: 'Claude Code' }]
    state.local = false
    open()
    fill()
    await vi.waitFor(() => expect(button('Start')?.disabled).toBe(false))
    expect(labels()).not.toContain('Agent')
    expect(labels()).not.toContain('Workspace')
    expect(button('Choose…')).toBeUndefined()
  })

  it('fills the plugin ID from the name and refuses a relative folder', async () => {
    open()
    type('Project name', 'My Weather Pane')
    type('Folder', 'plugins/hello')
    const id = dialog().querySelectorAll<HTMLInputElement>('input')[1]!
    expect(id.value).toBe('my-weather-pane')
    expect(dialog().textContent).toContain('Use a full path, such as /Users/you/plugins/hello.')
    expect(button('Start')?.disabled).toBe(true)
  })

  it('writes the scaffold, opens the task, and leaves the draft unsent on the chosen agent', async () => {
    open()
    fill()
    await vi.waitFor(() => expect(button('Start')?.disabled).toBe(false))
    button('Start')!.click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/t/task-1'))
    expect(scaffoldNodePlugin).toHaveBeenCalledWith(
      { folder: '/tmp/plugins/hello', pluginId: 'hello', name: 'Hello', git: true, kind: 'pane' },
      'node-a',
    )
    expect(createProject).toHaveBeenCalledWith({ path: '/tmp/plugins/hello', name: 'Hello', workspaceId: 'ws-1' })
    const [input] = starter.start.mock.calls.at(-1)!
    expect(input).toMatchObject({ taskId: 'task-1', title: 'Build Hello', choiceId: 'claude' })
    expect(input.draft).not.toMatch(/^@/)
    expect(input.draft).toContain('This folder, /tmp/plugins/hello,')
    expect(input.draft).toContain('source: { path: "/tmp/plugins/hello" }')
    expect(input.draft).toMatch(/What it should do: $/)
    expect(activateTaskSignals).toHaveBeenCalledWith({ id: 'task-1' })
  })

  it('names the failed step, and Try again resumes without writing the scaffold twice', async () => {
    vi.mocked(createTask).mockRejectedValueOnce(new Error('The node is offline.'))
    open()
    fill()
    await vi.waitFor(() => expect(button('Start')?.disabled).toBe(false))
    button('Start')!.click()
    await vi.waitFor(() => expect(dialog().textContent).toContain("Couldn't create the task. The node is offline."))
    button('Try again')!.click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(scaffoldNodePlugin).toHaveBeenCalledTimes(1)
    expect(createTask).toHaveBeenCalledTimes(2)
  })

  it('refuses a folder with files in it', async () => {
    vi.mocked(scaffoldNodePlugin).mockRejectedValueOnce(
      new ApiError('The folder must be missing or empty.', 409, 'not-empty'),
    )
    open()
    type('Project name', 'Other')
    type('Folder', '/tmp/plugins/other')
    await vi.waitFor(() => expect(button('Start')?.disabled).toBe(false))
    button('Start')!.click()
    await vi.waitFor(() =>
      expect(dialog().textContent).toContain('That folder has files in it. Pick a new or empty folder.'),
    )
    expect(createProject).not.toHaveBeenCalled()
  })

  it('drafts the data source prompt from the row and the picked sources', async () => {
    open('data-source')
    fill()
    type('What should one row be?', 'An issue with its pull request')
    dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    await vi.waitFor(() => expect(button('Start')?.disabled).toBe(false))
    button('Start')!.click()
    await vi.waitFor(() => expect(starter.start).toHaveBeenCalled())
    expect(scaffoldNodePlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'data-source',
        dataSource: { row: 'An issue with its pull request', inputs: [{ source: 'linear:issues' }] },
      }),
      'node-a',
    )
    const draft = starter.start.mock.calls.at(-1)![0].draft as string
    expect(draft).toContain('One row is: An issue with its pull request')
    expect(draft).toContain('- Linear issues (`linear:issues`)')
    expect(draft).not.toContain('npm create acorn-plugin')
    expect(draft).toMatch(/The rules for each row: $/)
  })
})
