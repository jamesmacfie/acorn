import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { integrationsKey, prefsKey, projectsKey, tasksKey, workspacesKey, type Task } from '@acorn/protocol/api.ts'
import { paneRegistry, type PaneContribution } from '../../host/registries/panes/panes'
import { railMarkerRegistry } from '../../host/registries/rail/railMarkerFeed'
import type { Disposable } from '../../kit/lib/state/registry'
import { activeTaskId, setActiveTaskId, setSelectedSource } from '../tasks/tasks'

const { createTaskMock } = vi.hoisted(() => ({ createTaskMock: vi.fn() }))
vi.mock('../tasks/taskMutations', () => ({
  archiveTask: vi.fn(),
  createTask: createTaskMock,
  patchTask: vi.fn(),
}))
vi.mock('../tasks/taskBridge', () => ({
  taskBridge: () => ({ project: { get: async () => ({ config: { branchPrefix: null } }) } }),
}))

// The rail's hover prefetch. A task switch disposes the whole task scope, so what makes coming back
// cheap is the cache being warm before the click (docs/panes.md § Contributions).
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
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .ui-modal-actions button')].find((button) => button.textContent === 'Create task')!.click()
    await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ skipSetup: true })))

    host.querySelector<HTMLButtonElement>('.tabrail-bottom')!.click()
    expect(checkbox()?.checked).toBe(false)
  })
})
