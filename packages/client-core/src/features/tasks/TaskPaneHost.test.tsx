import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import { paneRegistry, type PaneContribution } from '../../host/registries/panes/panes'
import type { Disposable } from '../../kit/lib/state/registry'
import TaskPaneHost from './TaskPaneHost'
import { applyLayoutAction, type LayoutAction, type TaskLayout } from './taskLayout'
import { CORE_PANE_POINT, type PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import { extensionRegistry, type ExtensionContribution } from '../../host/registries/extensionPoints/extensionPoints'
import { clearAnnotations } from '../../host/annotations/annotations'

vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: undefined }) }))

// The busiest host in the shell: it decides which panes a task shows, drops the ones this task or
// this environment cannot offer, and contains a pane that throws. The layout reducer has its own unit
// tests; what a render adds is that the reducer's answer reaches the screen, and that the fallbacks
// are real rather than intended.

// All three `requires` shapes, answered from a table the tests below set: the bare word, `{ plugin }`
// and `{ seam }`. The predicate itself has a unit test of its own; this stub only has to be honest
// about the shapes.
const capabilities = vi.hoisted(() => ({ desktop: true, terminal: true, preview: true }))
vi.mock('../../infra/node/hostCapabilities', () => ({
  hasHostCapability: (requirement: 'none' | 'desktop' | { plugin?: string; seam?: string } = 'none') =>
    requirement === 'none'
      ? true
      : requirement === 'desktop'
        ? capabilities.desktop
        : (capabilities[(requirement.plugin ?? requirement.seam) as keyof typeof capabilities] ?? true),
}))

// The layout store and the node's freshness are read through modules of their own. Stub them so a
// failure here means the host, not one of its neighbours. The marker feed is real, because the
// switcher's `core:pane` marks travel through it.
const layout = vi.hoisted(() => ({
  panes: ['pr'] as string[],
  pinned: [] as string[],
  weights: {} as Record<string, number>,
}))
const maximized = vi.hoisted(() => ({ pane: undefined as string | undefined }))
const dispatched = vi.hoisted(() => [] as unknown[])
// A dispatch re-renders the host, as the real store does, so a test sees what a layout change tears down.
vi.mock('./tasks', async () => {
  const { createSignal } = await import('solid-js')
  const [version, setVersion] = createSignal(0)
  return {
    layoutForTask: () => (version(), layout),
    maximizedPane: () => maximized.pane,
    dispatchLayout: (_taskId: string, action: unknown) => {
      dispatched.push(action)
      setVersion((current) => current + 1)
    },
  }
})
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => 'node-1' }))
vi.mock('../../infra/node/fleet', () => ({ nodeState: () => ({}) }))
vi.mock('../../infra/node/freshness', () => ({ freshnessOf: () => 'live' }))

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
  capabilities.preview = true
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
  clearAnnotations()
})

describe('TaskPaneHost', () => {
  it('opens the clicked pane menu without showing it, then dispatches its layout verb', () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })
    mount()
    const icon = [...host.querySelectorAll<HTMLElement>('.pane-switcher .tabrail-tab')].find(
      (entry) => entry.getAttribute('aria-label') === 'changes',
    )!
    icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }))
    expect(dispatched).toEqual([])
    expect([...document.querySelectorAll('[role="menuitem"]')].map((entry) => entry.textContent?.trim())).toEqual([
      'Open',
      'Open beside',
    ])
    ;[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent?.trim() === 'Open beside')
      ?.click()
    expect(dispatched).toEqual([{ type: 'add', pane: 'changes' }])
  })
  it("offers Copy URL on a pane that names the task's address, and copies it", async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    pane({ id: 'pr', order: 0 })
    pane({ id: 'linear', order: 1, url: (subject) => `https://linear.app/acme/issue/${subject.id}` })
    mount()
    const icon = [...host.querySelectorAll<HTMLElement>('.pane-switcher .tabrail-tab')].find(
      (entry) => entry.getAttribute('aria-label') === 'linear',
    )!
    icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }))
    ;[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent?.trim() === 'Copy URL')
      ?.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('https://linear.app/acme/issue/task-1'))
    vi.unstubAllGlobals()
  })
  it("draws the layout's panes, in the layout's order", () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })
    pane({ id: 'notes', order: 2 })
    layout.panes = ['notes', 'pr']

    mount()

    // The layout's order, not the registry's: the layout is what the user arranged.
    expect(drawn()).toEqual(['notes', 'pr'])
  })

  it('falls back to the first pane the task does offer when its layout names one it cannot show', () => {
    // A layout saved while the PR pane's plugin ran, on a task this one can't show it for.
    pane({ id: 'pr', order: 0, when: (subject) => subject.github !== null })
    pane({ id: 'changes', order: 1 })
    layout.panes = ['pr']

    mount(task({ github: null }))

    expect(drawn()).toEqual(['changes'])
    expect(host.textContent).not.toContain('No pane to show')
  })

  // The code host's declared pane, wherever it sits in the switcher.
  it("opens an empty layout on its change request's pane, and otherwise on the first pane", () => {
    pane({ id: 'changes', order: 0 })
    pane({ id: 'gitlab-test-mr', order: 5 })
    layout.panes = []

    mount(task({ changeRequest: { provider: 'gitlab-test', number: 12, pane: 'gitlab-test-mr' } }))
    expect(drawn()).toEqual(['gitlab-test-mr'])
    dispose()
    host.remove()

    mount(task({ changeRequest: null }))
    expect(drawn()).toEqual(['changes'])
  })

  it('marks the fallback pane as shown, and opens a second pane beside it', () => {
    pane({ id: 'pr', label: 'PR', order: 0, when: (subject) => subject.github !== null })
    pane({ id: 'agents', label: 'Agent', order: 1 })
    pane({ id: 'changes', label: 'Changes', order: 2 })
    layout.panes = ['pr']

    mount(task({ github: null }))

    const tabs = () => [...host.querySelectorAll<HTMLElement>('.pane-switcher [aria-pressed]')]
    const pressed = () =>
      tabs()
        .filter((tab) => tab.getAttribute('aria-pressed') === 'true')
        .map((tab) => tab.getAttribute('aria-label'))
    expect(pressed()).toEqual(['Agent'])
    // One pane on screen, so there is nothing to close.
    expect(host.querySelector('[aria-label="Close Agent"]')).toBeNull()

    tabs()
      .find((tab) => tab.getAttribute('aria-label') === 'Changes')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))

    // The layout as drawn is what the add applies to, so the person gets the pane they were looking
    // at and the one they asked for, rather than the PR pane nobody can see plus Changes.
    const next = (dispatched as LayoutAction[]).reduce<TaskLayout>(
      (current, action) => applyLayoutAction(current, action),
      { panes: ['pr'] },
    )
    expect(next.panes).toEqual(['agents', 'changes'])
  })

  it('says so when the layout has nothing left to draw', () => {
    // The seam gate, which is what the browser preview asks: a shell without preview views never
    // offers the pane.
    capabilities.preview = false
    pane({ id: 'preview', order: 0, requires: { seam: 'preview' } })
    layout.panes = ['preview']

    mount()

    expect(drawn()).toEqual([])
    expect(host.textContent).toContain('No pane to show')
  })

  it('drops a pane this environment cannot host from the switcher too', () => {
    capabilities.terminal = false
    pane({ id: 'pr', order: 0 })
    pane({ id: 'agent', order: 1, requires: { plugin: 'terminal' } })

    mount()

    const tabs = [...host.querySelectorAll('.pane-switcher [aria-pressed]')].map((node) =>
      node.getAttribute('aria-label'),
    )
    expect(tabs.some((label) => label?.includes('agent'))).toBe(false)
  })

  it('shows only panes that opt into archived tasks', () => {
    pane({ id: 'pr', label: 'PR review', order: 0 })
    pane({ id: 'agents', label: 'Agent', order: 1, readsArchived: true })
    pane({ id: 'notes', label: 'Notes', order: 2, readsArchived: true })
    pane({ id: 'changes', label: 'Changes', order: 3 })
    layout.panes = ['pr', 'notes', 'changes']

    mount(task({ status: 'archived', worktreePath: null }))

    expect(drawn()).toEqual(['notes'])
    const tabs = [...host.querySelectorAll('.pane-switcher [aria-pressed]')].map((node) =>
      node.getAttribute('aria-label'),
    )
    expect(tabs).toEqual(['Agent', 'Notes'])
  })

  it('keeps a command-only pane addressable without putting it in the switcher', () => {
    pane({ id: 'findings', order: 0, showInSwitcher: false })
    layout.panes = ['findings']

    mount()

    expect(drawn()).toEqual(['findings'])
    const tabs = [...host.querySelectorAll('.pane-switcher [aria-pressed]')].map((node) =>
      node.getAttribute('aria-label'),
    )
    expect(tabs.some((label) => label?.includes('findings'))).toBe(false)
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

  it('keeps resizing after the first step of a divider drag changes the layout', () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })
    layout.panes = ['pr', 'changes']
    vi.stubGlobal('requestAnimationFrame', (step: FrameRequestCallback) => (step(0), 1))
    mount()
    for (const slot of host.querySelectorAll<HTMLElement>('.task-slot'))
      slot.getBoundingClientRect = () => ({ width: 400 }) as DOMRect
    const divider = host.querySelector<HTMLElement>('.pane-divider')!
    divider.setPointerCapture = () => {}
    expect(divider.getAttribute('aria-label')).toBe('Resize pr and changes')

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400 }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 410 }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 450 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 450 }))

    expect(dispatched.map((action) => (action as { deltaPx: number }).deltaPx)).toEqual([10, 50])
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

  it('marks consenting pane buttons only, keeps their menu, and drops the marks when the task closes', async () => {
    pane({ id: 'pr', order: 0, statusAnnotations: true })
    pane({ id: 'changes', order: 1 })
    const marks = vi.fn(async (keys: PluginAnnotationKey[]) =>
      keys.map((key) => ({ key, severity: 'danger' as const, text: 'Checks failing' })),
    )
    registered.push(
      extensionRegistry.register({
        id: 'plugin:ci:pane-status',
        pluginId: 'ci',
        point: CORE_PANE_POINT,
        label: 'CI status',
        order: 500,
        carrier: 'items',
        marks,
      } as ExtensionContribution),
    )
    mount()
    const icon = (id: string) =>
      [...host.querySelectorAll<HTMLElement>('.pane-switcher .tabrail-tab')].find(
        (entry) => entry.getAttribute('aria-label') === id,
      )!

    await vi.waitFor(() => expect(icon('pr').querySelectorAll('.tabrail-marker')).toHaveLength(1))
    expect(marks).toHaveBeenCalledOnce()
    expect(marks.mock.calls[0]![0]).toEqual([{ paneId: 'pr', taskId: 'task-1' }])
    expect(icon('pr').querySelector('.sr-only')?.textContent).toBe('Checks failing — ci')
    expect(icon('changes').querySelectorAll('.tabrail-marker')).toHaveLength(0)

    // The marked button still opens its menu without showing the pane.
    icon('pr').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }),
    )
    expect(dispatched).toEqual([])
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    // Closing the task unmounts its host; the next switcher to draw that pane must not inherit the mark.
    dispose()
    host.remove()
    marks.mockImplementation(async () => [])
    mount(task({ id: 'task-2' }))
    await vi.waitFor(() => expect(marks).toHaveBeenCalledTimes(2))
    expect(icon('pr').querySelectorAll('.tabrail-marker')).toHaveLength(0)
  })

  it('routes a switcher click through the layout reducer, and a meta-click opens beside', () => {
    pane({ id: 'pr', order: 0 })
    pane({ id: 'changes', order: 1 })

    mount()
    // Looked up for each click, because a dispatch redraws the switcher.
    const tab = () => [...host.querySelectorAll<HTMLElement>('.pane-switcher [aria-pressed]')][1]
    tab()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    tab()?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))

    // Every layout change goes through the one reducer; the host never writes the store itself.
    expect(dispatched).toEqual([
      { type: 'show', pane: 'changes' },
      { type: 'add', pane: 'changes' },
    ])
  })
})
