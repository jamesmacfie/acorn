import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import { paneRegistry, type PaneContribution } from '../registries/panes'
import type { Disposable } from '../registries/registry'
import TaskPaneHost from './TaskPaneHost'

// The busiest host in the shell: it decides which panes a task shows, drops the ones this task or
// this environment cannot offer, and contains a pane that throws. The layout reducer has its own unit
// tests; what a render adds is that the reducer's answer reaches the screen, and that the fallbacks
// are real rather than intended.

const capabilities = vi.hoisted(() => ({ desktop: true, terminal: true }))
vi.mock('../infra/node/hostCapabilities', () => ({
  hasHostCapability: (requirement: 'none' | 'desktop' | 'terminal' = 'none') =>
    requirement === 'none' || capabilities[requirement],
}))

// The layout store, the node's freshness, and the rail's markers are all read through modules of
// their own. Stub them so a failure here means the host, not one of its neighbours.
const layout = vi.hoisted(() => ({ panes: ['pr'] as string[], pinned: [] as string[], weights: {} as Record<string, number> }))
const maximized = vi.hoisted(() => ({ pane: undefined as string | undefined }))
const dispatched = vi.hoisted(() => [] as unknown[])
vi.mock('./tasks', () => ({
  layoutForTask: () => layout,
  maximizedPane: () => maximized.pane,
  dispatchLayout: (_taskId: string, action: unknown) => void dispatched.push(action),
}))
vi.mock('../infra/node/activeNode', () => ({ activeNodeId: () => 'node-1' }))
vi.mock('../infra/node/fleet', () => ({ nodeState: () => ({}) }))
vi.mock('../infra/node/freshness', () => ({ freshnessOf: () => 'live' }))
vi.mock('../registries/railMarkers', () => ({ markersFor: () => [] }))

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Fix the thing',
  icon: null,
  origin: 'manual',
  projectId: 'p1',
  branch: 'james/fix',
  github: null,
  worktreePath: '/tmp/wt',
  pullNumber: null,
  status: 'active',
  parentId: null,
  sort: 0,
  links: [],
  ...overrides,
})

const pane = (contribution: Partial<PaneContribution> & Pick<PaneContribution, 'id'>) =>
  registered.push(
    paneRegistry.register({
      label: contribution.id,
      glyph: 'circle',
      order: 0,
      component: () => <span data-mark={contribution.id} />,
      ...contribution,
    } as PaneContribution),
  )

const mount = (current = task()) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <TaskPaneHost task={current} onCloseTask={() => {}} />, host)
}

const drawn = () => [...host.querySelectorAll('.task-slot')].map((node) => node.getAttribute('data-pane-id'))

beforeEach(() => {
  capabilities.desktop = true
  capabilities.terminal = true
  layout.panes = ['pr']
  layout.pinned = []
  layout.weights = {}
  maximized.pane = undefined
  dispatched.length = 0
})

afterEach(() => {
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('TaskPaneHost', () => {
  it('draws the layout\'s panes, in the layout\'s order', () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })
    pane({ id: 'notes', order: 2 })
    layout.panes = ['notes', 'pr']

    mount()

    // The layout's order, not the registry's: the layout is what the user arranged.
    expect(drawn()).toEqual(['notes', 'pr'])
  })

  it('falls back to the first pane the task does offer when its layout names one it cannot show', () => {
    // DEFAULT_PANE is the PR pane, and a task on a project with no GitHub remote has no PR.
    pane({ id: 'pr', order: 0, when: (subject) => subject.github !== null })
    pane({ id: 'changes', order: 1 })
    layout.panes = ['pr']

    mount(task({ github: null }))

    expect(drawn()).toEqual(['changes'])
    expect(host.textContent).not.toContain('No panes available here')
  })

  it('says so when the layout has nothing left to draw', () => {
    capabilities.desktop = false
    pane({ id: 'preview', order: 0, requires: 'desktop' })
    layout.panes = ['preview']

    mount()

    expect(drawn()).toEqual([])
    expect(host.textContent).toContain('No panes available here')
  })

  it('drops a pane this environment cannot host from the switcher too', () => {
    capabilities.terminal = false
    pane({ id: 'pr', order: 0 })
    pane({ id: 'agent', order: 1, requires: { plugin: 'terminal' } })

    mount()

    const tabs = [...host.querySelectorAll('.pane-switcher [aria-pressed]')].map((node) => node.getAttribute('aria-label'))
    expect(tabs.some((label) => label?.includes('agent'))).toBe(false)
  })

  it('shows only the maximized pane while one is maximized', () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })
    layout.panes = ['pr', 'changes']
    maximized.pane = 'changes'

    mount()

    expect(drawn()).toEqual(['changes'])
    // No splitter either: there is nothing on the other side of it.
    expect(host.querySelector('.pane-divider')).toBeNull()
  })

  it('puts a splitter between adjacent panes and none after the last', () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })
    pane({ id: 'notes', order: 2 })
    layout.panes = ['pr', 'changes', 'notes']

    mount()

    expect(host.querySelectorAll('.pane-divider')).toHaveLength(2)
  })

  it('contains a pane that throws and keeps its neighbour', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    pane({
      id: 'pr',
      order: 0,
      component: () => {
        throw new Error('pane exploded')
      },
    })
    pane({ id: 'changes', order: 1 })
    layout.panes = ['pr', 'changes']

    mount()

    // Both slots are still there, and the broken one shows a recoverable failure rather than taking
    // the task view with it.
    expect(drawn()).toEqual(['pr', 'changes'])
    expect(host.querySelector('.contribution-failed')).not.toBeNull()
    expect(host.querySelector('[data-mark="changes"]')).not.toBeNull()
    vi.restoreAllMocks()
  })

  it('routes a switcher click through the layout reducer, and a meta-click opens beside', () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })

    mount()
    const tab = [...host.querySelectorAll<HTMLElement>('.pane-switcher [aria-pressed]')][1]
    tab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    tab?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))

    // Every layout change goes through the one reducer; the host never writes the store itself.
    expect(dispatched).toEqual([{ type: 'show', pane: 'changes' }, { type: 'add', pane: 'changes' }])
  })
})
