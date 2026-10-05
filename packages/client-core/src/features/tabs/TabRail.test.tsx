import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { integrationsKey, prefsKey, projectsKey, tasksKey, workspacesKey, type Task } from '@acorn/protocol/api.ts'
import { paneRegistry, type PaneContribution } from '../../host/registries/panes/panes'
import { railMarkerRegistry } from '../../host/registries/rail/railMarkerFeed'
import type { Disposable } from '../../kit/lib/state/registry'
import { activeTaskId, setActiveTaskId, setSelectedSource } from '../tasks/tasks'

const { createTaskMock, readJsonMock } = vi.hoisted(() => ({ createTaskMock: vi.fn(), readJsonMock: vi.fn() }))
vi.mock('../../infra/node/apiClient', () => ({ readJson: readJsonMock }))
vi.mock('../tasks/taskMutations', () => ({
  archiveTask: vi.fn(),
  createTask: createTaskMock,
  patchTask: vi.fn(),
}))
vi.mock('../tasks/taskBridge', () => ({
  taskBridge: () => ({ project: { get: async () => ({ config: { branchPrefix: null } }) } }),
}))

// The rail's hover prefetch. A task switch disposes the whole task scope, so what makes coming back
// cheap is the cache being warm before the click (docs/panes/contributions.md § Contributions).
//
// The rail is a router surface; nothing here navigates, so the router is answered rather than mounted.
vi.mock('@solidjs/router', () => ({
  useNavigate: () => () => {},
  useParams: () => ({}),
  A: (props: { children?: unknown }) => props.children,
}))

const { default: TabRail } = await import('./TabRail')

const task = (id: string, title: string, parentId: string | null = null): Task => ({
  id,
  title,
  icon: null,
  origin: 'manual',
  projectId: 'p1',
  branch: `james/${id}`,
  github: null,
  worktreePath: `/tmp/${id}`,
  pullNumber: null,
  status: 'active',
  parentId,
  sort: 0,
  links: [],
})
const workflowTask = (id: string, title: string, parentId: string): Task => ({
  ...task(id, title, parentId),
  origin: 'workflows:child',
})

const prefetched: string[] = []
const pane = (over: Partial<PaneContribution> = {}): PaneContribution => ({
  id: 'notes', label: 'Notes', glyph: 'notepad-text', order: 30,
  component: () => null,
  prefetch: (asked) => void prefetched.push(`notes:${asked.id}`),
  ...over,
})

let host: HTMLElement
let dispose: (() => void) | undefined
let queryClient: QueryClient
const registered: Disposable[] = []

beforeEach(() => {
  vi.useFakeTimers()
  createTaskMock.mockReset()
  readJsonMock.mockReset()
  readJsonMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/config')) return { config: { branchPrefix: null } }
    if (url.includes('worktree-availability')) return { available: true }
    if (url.endsWith('/worktrees')) return []
    if (url.endsWith('/branches')) return { current: 'main', tasks: [], other: [{ name: 'main', committedAt: 1 }] }
    throw new Error('No live Node in this test.')
  })
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const entry of registered.splice(0)) entry.dispose()
  prefetched.length = 0
  setActiveTaskId(null)
  setSelectedSource(null)
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'elementFromPoint')
  vi.useRealTimers()
})

const mount = (tasks = [task('t1', 'First'), task('t2', 'Second')], gitProject = false) => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  queryClient.setQueryData(tasksKey, tasks)
  queryClient.setQueryData(workspacesKey, gitProject ? [{ id: 'w1', name: 'Workspace', projects: [{ id: 'p1' }] }] : [])
  queryClient.setQueryData(projectsKey, [{ id: 'p1', name: 'acorn', workspaceId: 'w1', vcs: gitProject ? 'git' : null, color: null, hidden: false }])
  queryClient.setQueryData(integrationsKey, { integrations: [] })
  queryClient.setQueryData(prefsKey, {})
  dispose = render(() => <QueryClientProvider client={queryClient}><TabRail /></QueryClientProvider>, host)
  return [...host.querySelectorAll('.tabrail-item')] as HTMLElement[]
}

const hover = (row: HTMLElement) => row.dispatchEvent(new Event('pointerenter', { bubbles: true }))
const leave = (row: HTMLElement) => row.dispatchEvent(new Event('pointerleave', { bubbles: true }))
const dispatchMouse = (row: HTMLElement, type: string, clientY: number, clientX = 10) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  row.dispatchEvent(event)
  return event
}
const taskLabels = () => [...host.querySelectorAll<HTMLElement>('.tabrail-item')]
  .map((row) => row.querySelector('button')?.getAttribute('aria-label'))
const pointAt = (element: Element) => {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => element),
  })
}

describe('hovering a task row', () => {
  it('warms that task’s panes once the pointer has settled', () => {
    registered.push(paneRegistry.register(pane()))
    const rows = mount()
    expect(rows).toHaveLength(2)

    hover(rows[0]!)
    vi.advanceTimersByTime(200)
    expect(prefetched).toEqual(['notes:t1'])
  })

  it('fetches nothing for a row the pointer only crossed', () => {
    registered.push(paneRegistry.register(pane()))
    const rows = mount()

    hover(rows[0]!)
    vi.advanceTimersByTime(50)
    leave(rows[0]!)
    vi.advanceTimersByTime(500)
    expect(prefetched).toEqual([])
  })

  it('asks every pane that offers a prefetch, and no pane that does not', () => {
    registered.push(paneRegistry.register(pane()))
    registered.push(paneRegistry.register(pane({ id: 'agents', label: 'Agent', order: 15, prefetch: (asked) => void prefetched.push(`agents:${asked.id}`) })))
    registered.push(paneRegistry.register(pane({ id: 'quiet', label: 'Quiet', order: 40, prefetch: undefined })))
    const rows = mount()

    hover(rows[1]!)
    vi.advanceTimersByTime(200)
    expect(prefetched.sort()).toEqual(['agents:t2', 'notes:t2'])
  })
})

describe('dragging a task row', () => {
  it('opens row actions on right-click without selecting or dragging that task', () => {
    setActiveTaskId('t1')
    const rows = mount()
    rows[1]!.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }))
    rows[1]!.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }))

    expect(activeTaskId()).toBe('t1')
    expect(host.querySelector('[data-dragging]')).toBeNull()
    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Actions for Second')
  })

  it('moves a task after an adjacent row when dropped on its lower half', async () => {
    const rows = mount()
    vi.spyOn(rows[1]!, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 52 } as DOMRect)
    pointAt(rows[1]!)

    dispatchMouse(rows[0]!, 'mousedown', 10)
    dispatchMouse(rows[0]!, 'mousemove', 40)
    expect(rows[1]!.dataset.dropPosition).toBe('after')

    dispatchMouse(rows[0]!, 'mouseup', 40)
    await vi.waitFor(() => expect(taskLabels()).toEqual(['Second', 'First']))
    expect(host.querySelector('[data-dragging]')).toBeNull()
    expect(host.querySelector('[data-drop-position]')).toBeNull()
  })

  it('moves a root with its descendants without changing the hierarchy', async () => {
    const rows = mount([
      task('parent', 'Parent'),
      task('child', 'Child', 'parent'),
      task('other', 'Other'),
    ])
    vi.spyOn(rows[2]!, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 52 } as DOMRect)
    pointAt(rows[2]!)

    dispatchMouse(rows[0]!, 'mousedown', 10)
    dispatchMouse(rows[0]!, 'mousemove', 40)
    dispatchMouse(rows[0]!, 'mouseup', 40)

    await vi.waitFor(() => expect(taskLabels()).toEqual(['Other', 'Parent', 'Child']))
    expect([...host.querySelectorAll<HTMLElement>('.tabrail-item')].map((row) => row.dataset.taskDepth))
      .toEqual([undefined, undefined, '1'])
  })

  it('does not offer a drop that would separate a child from its parent', () => {
    const rows = mount([
      task('parent', 'Parent'),
      task('child', 'Child', 'parent'),
      task('other', 'Other'),
    ])
    vi.spyOn(rows[2]!, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 52 } as DOMRect)
    pointAt(rows[2]!)

    dispatchMouse(rows[1]!, 'mousedown', 40)
    const mouseMove = dispatchMouse(rows[1]!, 'mousemove', 12)

    expect(mouseMove.defaultPrevented).toBe(true)
    expect(host.querySelector('[data-drop-position]')).toBeNull()
    expect(taskLabels()).toEqual(['Parent', 'Child', 'Other'])
  })

  it('reorders visible roots without dropping a collapsed workflow descendant from the saved order', async () => {
    const rows = mount([
      task('workflow-root', 'Workflow root'),
      workflowTask('workflow-child', 'Workflow child', 'workflow-root'),
      task('manual-root', 'Manual root'),
    ])
    expect(taskLabels()).toEqual(['Workflow root', 'Manual root'])
    vi.spyOn(rows[1]!, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 52 } as DOMRect)
    pointAt(rows[1]!)

    dispatchMouse(rows[0]!, 'mousedown', 10)
    dispatchMouse(rows[0]!, 'mousemove', 40)
    dispatchMouse(rows[0]!, 'mouseup', 40)

    await vi.waitFor(() => expect(taskLabels()).toEqual(['Manual root', 'Workflow root']))
    host.querySelector<HTMLButtonElement>('.tabrail-task-disclosure')!.click()
    await vi.waitFor(() => expect(taskLabels()).toEqual(['Manual root', 'Workflow root', 'Workflow child']))
  })
})

describe('task lineage in the core rail fallback', () => {
  it('collapses workflow descendants, reveals the selected ancestor path, and expands on demand', async () => {
    mount([
      task('root', 'Root'),
      workflowTask('one', 'One', 'root'),
      workflowTask('nested', 'Nested', 'one'),
      workflowTask('two', 'Two', 'root'),
    ])
    expect(taskLabels()).toEqual(['Root'])
    expect(host.querySelector<HTMLButtonElement>('.tabrail-task-disclosure')?.textContent).toContain('3')

    host.querySelector<HTMLButtonElement>('.tabrail-task-disclosure')!.click()
    await vi.waitFor(() => expect(taskLabels()).toEqual(['Root', 'One', 'Nested', 'Two']))

    host.querySelector<HTMLButtonElement>('.tabrail-task-disclosure')!.click()
    setActiveTaskId('nested')
    await vi.waitFor(() => expect(taskLabels()).toEqual(['Root', 'One', 'Nested']))
  })

  it('indents a child under its parent and keeps the child selectable', () => {
    mount([
      task('child', 'Child', 'parent'),
      task('other', 'Other'),
      task('parent', 'Parent'),
    ])
    const rows = [...host.querySelectorAll<HTMLElement>('.tabrail-item')]
    expect(rows.map((row) => row.querySelector('button')?.getAttribute('aria-label'))).toEqual([
      'Other', 'Parent', 'Child',
    ])
    expect(rows.map((row) => row.dataset.taskDepth)).toEqual([undefined, undefined, '1'])

    rows[2]!.querySelector<HTMLButtonElement>('button')!.click()
    expect(activeTaskId()).toBe('child')
  })

  it('keeps orphaned and cyclic rows flat and selectable', () => {
    mount([
      task('orphan', 'Orphan', 'missing'),
      task('cycle-a', 'Cycle A', 'cycle-b'),
      task('cycle-b', 'Cycle B', 'cycle-a'),
    ])
    const rows = [...host.querySelectorAll<HTMLElement>('.tabrail-item')]
    expect(rows.map((row) => row.dataset.taskDepth)).toEqual([undefined, undefined, undefined])
    expect(rows.map((row) => row.querySelector('button')?.getAttribute('aria-label'))).toEqual([
      'Orphan', 'Cycle A', 'Cycle B',
    ])

    rows[2]!.querySelector<HTMLButtonElement>('button')!.click()
    expect(activeTaskId()).toBe('cycle-b')
  })

  it('retains a child row when its missing parent changes only the projected depth', async () => {
    const parent = task('parent', 'Parent')
    const child = task('child', 'Child', parent.id)
    mount([parent, child])
    const before = [...host.querySelectorAll<HTMLElement>('.tabrail-item')]
      .find((row) => row.querySelector('button')?.getAttribute('aria-label') === 'Child')
    expect(before?.dataset.taskDepth).toBe('1')

    queryClient.setQueryData(tasksKey, [child])
    await vi.waitFor(() => {
      const row = [...host.querySelectorAll<HTMLElement>('.tabrail-item')]
        .find((candidate) => candidate.querySelector('button')?.getAttribute('aria-label') === 'Child')
      expect(row?.dataset.taskDepth).toBeUndefined()
    })

    const after = [...host.querySelectorAll<HTMLElement>('.tabrail-item')]
      .find((row) => row.querySelector('button')?.getAttribute('aria-label') === 'Child')
    expect(after).toBe(before)
  })
})

describe('a row whose markers are read again', () => {
  // A contributor builds fresh marker objects on every read, and the agents plugin's rail marker is
  // read again on every event a streaming agent sends. Rebuilding the elements each time restarted a
  // spinning marker's turn 25 times a second.
  it('keeps the marker elements while the markers say the same thing', () => {
    const [tick, setTick] = createSignal(0)
    const [label, setLabel] = createSignal('1 agent working')
    registered.push(railMarkerRegistry.register({
      id: 'test',
      order: 10,
      markers: (target) => {
        tick()
        return target.kind === 'task'
          ? [{ id: 'working', label: label(), icon: 'loader-circle', tone: 'accent', busy: true, placements: ['top-end'] }]
          : []
      },
    }))
    mount()
    const before = [...host.querySelectorAll('.tabrail-marker')]
    expect(before).toHaveLength(2)

    for (let index = 1; index <= 25; index++) setTick(index)
    expect([...host.querySelectorAll('.tabrail-marker')]).toEqual(before)
    expect(host.querySelectorAll('.tabrail-marker')[0]).toBe(before[0])

    setLabel('2 agents working')
    expect(host.querySelector('.tabrail-task')?.getAttribute('data-tip-legend')).toContain('2 agents working')
  })
})

describe('new task setup choice', () => {
  it('defaults to running setup, submits the opt-out, and resets it for the next task', async () => {
    setActiveTaskId('t1')
    mount(undefined, true)
    createTaskMock.mockResolvedValue(task('created', 'Skip setup'))

    host.querySelector<HTMLButtonElement>('.tabrail-bottom')!.click()
    // The dialog is a Modal, which portals to the body rather than rendering inside the rail.
    const checkbox = () => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')]
      .find((input) => input.closest('label')?.textContent?.includes('Skip setup script'))
    expect(checkbox()?.checked).toBe(false)

    const titleLabel = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find((label) => label.textContent === 'Title')!
    const title = document.getElementById(titleLabel.htmlFor) as HTMLInputElement
    title.value = 'Skip setup'
    title.dispatchEvent(new InputEvent('input', { bubbles: true }))
    checkbox()!.click()
    expect(checkbox()?.checked).toBe(true)
    await vi.waitFor(() => expect([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Create task')?.disabled).toBe(false))
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Create task')!.click()
    await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ skipSetup: true }), null))

    host.querySelector<HTMLButtonElement>('.tabrail-bottom')!.click()
    expect(checkbox()?.checked).toBe(false)
  })
})

describe('new task worktree validation', () => {
  it('does not accept a held availability answer from a closed dialog', async () => {
    setActiveTaskId('t1')
    mount(undefined, true)
    const pending: Array<(value: { available: boolean }) => void> = []
    readJsonMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/config')) return { config: { branchPrefix: null } }
      if (url.includes('worktree-availability')) {
        return new Promise<{ available: boolean }>((resolve) => {
          pending.push(resolve)
        })
      }
      if (url.endsWith('/branches')) return { current: 'main', tasks: [], other: [{ name: 'main', committedAt: 1 }] }
      if (url.endsWith('/worktrees')) return []
      throw new Error('No live Node.')
    })
    const open = () => host.querySelector<HTMLButtonElement>('.tabrail-bottom')!.click()
    const title = () => {
      const label = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find((field) => field.textContent === 'Title')!
      return document.getElementById(label.htmlFor) as HTMLInputElement
    }
    const submit = () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Create task')!
    const fill = (value: string) => {
      title().value = value
      title().dispatchEvent(new InputEvent('input', { bubbles: true }))
    }

    open()
    fill('Same title')
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
    const oldRequests = pending.splice(0)
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Cancel')!.click()
    open()
    fill('Same title')
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
    for (const resolve of oldRequests) resolve({ available: true })
    await Promise.resolve()
    expect(submit().disabled).toBe(true)
    submit().click()
    title().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(createTaskMock).not.toHaveBeenCalled()
    for (const resolve of pending) resolve({ available: true })
    await vi.waitFor(() => expect(submit().disabled).toBe(false))
  })

  it('allows creation when the availability request fails', async () => {
    setActiveTaskId('t1')
    mount(undefined, true)
    readJsonMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/config')) return { config: { branchPrefix: null } }
      throw new Error('Worktree lookup is unavailable.')
    })
    createTaskMock.mockResolvedValue(task('created', 'Cannot check'))
    host.querySelector<HTMLButtonElement>('.tabrail-bottom')!.click()
    const label = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find((field) => field.textContent === 'Title')!
    const title = document.getElementById(label.htmlFor) as HTMLInputElement
    title.value = 'Cannot check'
    title.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const submit = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Create task')!
    await vi.waitFor(() => expect(submit.disabled).toBe(false))
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull()
    submit.click()
    await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ branch: 'cannot-check' }), null))
  })

  it('keeps a typed branch, blocks click and Enter on a conflict, and clears the error after a rename', async () => {
    setActiveTaskId('t1')
    mount([{ ...task('t1', 'Taken'), branch: 'taken' }], true)
    readJsonMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/config')) return { config: { branchPrefix: null } }
      if (url.includes('worktree-availability')) return new URL(url, 'http://acorn.test').searchParams.get('branch') === 'taken'
        ? { available: false, reason: 'This branch name already exists in another worktree' }
        : { available: true }
      if (url.endsWith('/worktrees')) return []
      throw new Error('No live Node in this test.')
    })
    host.querySelector<HTMLButtonElement>('.tabrail-bottom')!.click()
    const input = (label: string) => {
      const field = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find((candidate) => candidate.textContent === label)!
      return document.getElementById(field.htmlFor) as HTMLInputElement
    }
    const fill = (field: HTMLInputElement, value: string) => {
      field.value = value
      field.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }
    const submit = () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Create task')!
    fill(input('Title'), 'Another title')
    const advanced = document.querySelector<HTMLDetailsElement>('[role="dialog"] details')!
    advanced.open = true
    advanced.dispatchEvent(new Event('toggle'))
    fill(input('Branch name'), 'taken')
    fill(input('Title'), 'Taken')
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('This branch name already exists in another worktree'))
    expect(input('Branch name').value).toBe('taken')
    expect(submit().disabled).toBe(true)
    submit().click()
    input('Title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(createTaskMock).not.toHaveBeenCalled()

    fill(input('Branch name'), 'available-name')
    await vi.waitFor(() => expect(submit().disabled).toBe(false))
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('This branch name already exists in another worktree')
    createTaskMock.mockResolvedValue(task('created', 'Taken'))
    submit().click()
    await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ branch: 'available-name', branchSource: 'exact' }), null))
  })
})


describe('advanced task branch choices', () => {
  it('shows the server suffix for a derived name and groups the bases by task and local branch', async () => {
    setActiveTaskId('t1')
    mount(undefined, true)
    readJsonMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/config')) return { config: { branchPrefix: null } }
      if (url.includes('worktree-availability')) return { available: true, branch: 'taken-2' }
      if (url.endsWith('/branches')) return { current: 'main', tasks: [{ branch: 'feature/parent', taskId: 't1', title: 'Parent work' }], other: [{ name: 'main', committedAt: 1 }] }
      if (url.endsWith('/worktrees')) return []
      throw new Error('No live Node.')
    })
    host.querySelector<HTMLButtonElement>('.tabrail-bottom')!.click()
    const field = (name: string) => {
      const label = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find((item) => item.textContent === name)!
      return document.getElementById(label.htmlFor)!
    }
    const title = field('Title') as HTMLInputElement
    title.value = 'Taken'
    title.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const advanced = document.querySelector<HTMLDetailsElement>('[role="dialog"] details')!
    expect(advanced.open).toBe(false)
    advanced.open = true
    advanced.dispatchEvent(new Event('toggle'))
    await vi.waitFor(() => expect((field('Branch name') as HTMLInputElement).value).toBe('taken-2'))
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('already exists')
    ;(field('Branch from') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')?.textContent).toContain('Active tasks'))
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain('Other local branches')
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain('Parent work')
    const parent = document.querySelector<HTMLButtonElement>('[role="option"][data-value="feature/parent"]')!
    parent.click()
    createTaskMock.mockResolvedValue(task('created', 'Taken'))
    const submit = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Create task')!
    await vi.waitFor(() => expect(submit.disabled).toBe(false))
    submit.click()
    await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ branch: 'taken', branchSource: 'derived', baseBranch: 'feature/parent' }), null))
  })
})
