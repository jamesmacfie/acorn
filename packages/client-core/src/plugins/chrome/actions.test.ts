import { afterEach, describe, expect, it, vi } from 'vitest'

const sendRaw = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }))
vi.mock('../../apiClient', () => ({
  readJson: vi.fn(),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: vi.fn(),
}))

const { runChromeAction } = await import('./actions')
const { paneRegistry } = await import('../../registries/panes')
const { projectSurfaceRegistry } = await import('../../registries/projectSurfaces')
const { clientEvents, consumePaneIntent, evictPendingIntents } = await import('../../registries/clientEvents')
const { setActiveTaskId } = await import('../../tasks/tasks')
const { setTaskLookup } = await import('../../tasks/taskLookup')
type Task = import('../../queries').Task
const { closePluginOverlay, pluginOverlayOpen } = await import('../frames/overlays')

// The two verbs that decide WHERE a rail row's detail appears, which is the one thing the descriptor tier
// could not previously express. They are disjoint by manifest rule, and this pins the runtime half of that:
// `openPane` still refuses without a task, `navigate` never needs one.

const item = { id: 'conn-1:ENG-42', title: 'Fix the thing' }
const disposables: { dispose(): void }[] = []

afterEach(() => {
  for (const entry of disposables.splice(0).reverse()) entry.dispose()
  evictPendingIntents('task-1')
  setActiveTaskId(null)
  setTaskLookup(() => undefined)
})

describe('openPane', () => {
  it('opens a task pane with the clicked row retained as its selection', () => {
    disposables.push(paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null }))
    setActiveTaskId('task-1')
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item })
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'conn-1:ENG-42' })
  })

  it('takes the reader to the task the click site named, and selects the row there', () => {
    // A dashboard row is drawn outside every task, so without the named task this would open the pane in
    // whatever task happened to be on screen — never the one the row is about.
    disposables.push(paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null }))
    setTaskLookup((taskId) => (taskId === 'task-2' ? ({ id: 'task-2', links: [] } as unknown as Task) : undefined))
    setActiveTaskId('task-1')
    const navigate = vi.fn()
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item, taskId: 'task-2', navigate })
    expect(navigate).toHaveBeenCalledWith('/t/task-2')
    expect(consumePaneIntent('task-2', 'board')).toEqual({ kind: 'plugin:select', item: 'conn-1:ENG-42' })
    evictPendingIntents('task-2')
  })

  it('refuses a task this node does not have, rather than opening the pane somewhere else', () => {
    disposables.push(paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null }))
    setTaskLookup(() => undefined)
    setActiveTaskId('task-1')
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item, taskId: 'task-2' })
    expect(consumePaneIntent('task-1', 'board')).toBeUndefined()
    expect(consumePaneIntent('task-2', 'board')).toBeUndefined()
  })

  it('still refuses when there is no task, because a task pane has nowhere else to go', () => {
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item })
    expect(consumePaneIntent('', 'board')).toBeUndefined()
  })
})

describe('openOverlay', () => {
  it('opens with no task, unlike openPane, and only one is up at a time', () => {
    // The verb that needs nothing from its click site: an overlay covers the window rather than taking a
    // row in a task's layout, which is what makes it usable from a chord pressed anywhere.
    runChromeAction({ verb: 'openOverlay', overlay: 'files' }, { pluginId: 'editor', nodeId: 'node-a' })
    expect(pluginOverlayOpen('editor', 'files')).toBe(true)

    runChromeAction({ verb: 'openOverlay', overlay: 'cards' }, { pluginId: 'board', nodeId: 'node-a' })
    expect(pluginOverlayOpen('editor', 'files')).toBe(false)
    expect(pluginOverlayOpen('board', 'cards')).toBe(true)

    closePluginOverlay()
    expect(pluginOverlayOpen('board', 'cards')).toBe(false)
  })
})

describe('surfaceAction', () => {
  // The one verb whose effect lands INSIDE a plugin. Fire-and-forget by design: a pane nobody has open
  // has no frame listening, which is the honest outcome for a command meaning "do this in the thing I
  // am looking at". It is deliberately NOT retained the way a pane intent is.
  it('emits the command id to the named surface, addressed by plugin', async () => {
    const heard: unknown[] = []
    const off = clientEvents.on('plugin:surface-action', (event) => void heard.push(event))
    runChromeAction({ verb: 'surfaceAction', surface: 'database' }, { pluginId: 'database', nodeId: 'node-a', commandId: 'execute' })
    off()
    expect(heard).toEqual([{ pluginId: 'database', surface: 'database', command: 'execute' }])
  })

  it('refuses without a command id, because what it delivers IS the command id', async () => {
    // A footer badge's click has no command in scope. Rather than invent a second name for the thing
    // being delivered, the verb declines there — visibly, so an author is told.
    const heard: unknown[] = []
    const off = clientEvents.on('plugin:surface-action', (event) => void heard.push(event))
    runChromeAction({ verb: 'surfaceAction', surface: 'database' }, { pluginId: 'database', nodeId: 'node-a' })
    off()
    expect(heard).toEqual([])
  })
})

describe('navigate', () => {
  it('addresses the item inside the project-scoped surface, with no task anywhere', () => {
    disposables.push(projectSurfaceRegistry.register({
      id: 'board-card', path: '/p/:projectId/x/board/cards/:key', item: 'key', order: 500, component: () => null,
    }))
    const navigate = vi.fn()
    runChromeAction({ verb: 'navigate', surface: 'board-card' }, {
      pluginId: 'board', nodeId: 'node-a', item, projectId: 'project-web', navigate,
    })
    expect(navigate).toHaveBeenCalledWith('/p/project-web/x/board/cards/conn-1%3AENG-42')
  })

  it('says so rather than navigating nowhere when no project is routed', () => {
    disposables.push(projectSurfaceRegistry.register({
      id: 'board-card', path: '/p/:projectId/x/board/cards/:key', item: 'key', order: 500, component: () => null,
    }))
    const navigate = vi.fn()
    runChromeAction({ verb: 'navigate', surface: 'board-card' }, { pluginId: 'board', nodeId: 'node-a', item, navigate })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does nothing for a surface this device never registered', () => {
    const navigate = vi.fn()
    runChromeAction({ verb: 'navigate', surface: 'board-card' }, {
      pluginId: 'board', nodeId: 'node-a', item, projectId: 'project-web', navigate,
    })
    expect(navigate).not.toHaveBeenCalled()
  })
})
