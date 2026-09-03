import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { integrationsKey, prefsKey, projectsKey, tasksKey, workspacesKey, type Task } from '@acorn/protocol/api.ts'
import { paneRegistry, type PaneContribution } from '../../host/registries/panes/panes'
import type { Disposable } from '../../kit/lib/registry'

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

const task = (id: string, title: string): Task => ({
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
  parentId: null,
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
const registered: Disposable[] = []

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const entry of registered.splice(0)) entry.dispose()
  prefetched.length = 0
  vi.useRealTimers()
})

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(tasksKey, [task('t1', 'First'), task('t2', 'Second')])
  client.setQueryData(workspacesKey, [])
  client.setQueryData(projectsKey, [{ id: 'p1', name: 'acorn', color: null, hidden: false }])
  client.setQueryData(integrationsKey, { integrations: [] })
  client.setQueryData(prefsKey, {})
  dispose = render(() => <QueryClientProvider client={client}><TabRail /></QueryClientProvider>, host)
  return [...host.querySelectorAll('.tabrail-item')] as HTMLElement[]
}

const hover = (row: HTMLElement) => row.dispatchEvent(new Event('pointerenter', { bubbles: true }))
const leave = (row: HTMLElement) => row.dispatchEvent(new Event('pointerleave', { bubbles: true }))

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
