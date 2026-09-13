import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { integrationsKey, prefsKey, projectsKey, tasksKey, workspacesKey, type Task } from '@acorn/protocol/api.ts'
import { paneRegistry, type PaneContribution } from '../../host/registries/panes/panes'
import type { Disposable } from '../../kit/lib/registry'
import { activeTaskId, setActiveTaskId, setSelectedSource } from '../tasks/tasks'

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

const mount = (tasks = [task('t1', 'First'), task('t2', 'Second')]) => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  queryClient.setQueryData(tasksKey, tasks)
  queryClient.setQueryData(workspacesKey, [])
  queryClient.setQueryData(projectsKey, [{ id: 'p1', name: 'acorn', color: null, hidden: false }])
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
})

describe('task lineage in the core rail fallback', () => {
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
