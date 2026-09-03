import { afterEach, describe, expect, it, vi } from 'vitest'

type RawResult = { ok: boolean; status: number; error?: { code: string; message: string } }
const sendRaw = vi.fn(async (..._args: unknown[]): Promise<RawResult> => ({ ok: true, status: 200 }))
vi.mock('../../infra/node/apiClient', () => ({
  readJson: vi.fn(),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: vi.fn(),
}))

// The toast is the part a clicker sees, and the one thing that must keep working now that the palette
// reads the answer instead: `activeToasts` is a signal a test would have to render to read, so the
// function is captured here.
const toasted: string[] = []
vi.mock('../../features/notifications/toast', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: (message: string) => void toasted.push(message),
}))

const { runChromeAction } = await import('./actions')
const { paneRegistry } = await import('../registries/panes/panes')
const { projectSurfaceRegistry } = await import('../registries/panes/projectSurfaces')
const { clientEvents, consumePaneIntent, evictPendingIntents } = await import('../registries/commands/clientEvents')
const { setActiveTaskId, setSelectedSource } = await import('../../features/tasks/tasks')
const { setTaskLookup } = await import('../../features/tasks/taskLookup')
type Task = import('../../infra/queries').Task
const { closePluginOverlay, pluginOverlayOpen } = await import('../frames/overlays')

// The two verbs that decide where a rail row's detail appears, which is the one thing the descriptor tier
// could not previously express. They are disjoint by manifest rule, and this pins the runtime half of that:
// `openPane` still refuses without a task, `navigate` never needs one.

const item = { id: 'conn-1:ENG-42', title: 'Fix the thing' }
const disposables: { dispose(): void }[] = []

afterEach(() => {
  toasted.length = 0
  sendRaw.mockClear()
  for (const entry of disposables.splice(0).reverse()) entry.dispose()
  evictPendingIntents('task-1')
  setActiveTaskId(null)
  setSelectedSource(null)
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
    // whatever task happened to be on screen, never the one the row is about.
    disposables.push(paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null }))
    setTaskLookup((taskId) => (taskId === 'task-2' ? ({ id: 'task-2', links: [] } as unknown as Task) : undefined))
    setActiveTaskId('task-1')
    const navigate = vi.fn()
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item, taskId: 'task-2', navigate })
    expect(navigate).toHaveBeenCalledWith('/t/task-2')
    expect(consumePaneIntent('task-2', 'board')).toEqual({ kind: 'plugin:select', item: 'conn-1:ENG-42' })
    evictPendingIntents('task-2')
  })

  it('still navigates when the named task is the active one but a Source browse is on screen', () => {
    // activeTaskId is sticky: it names whichever task you last had open, not whichever screen you're
    // looking at. A dashboard row for that same task must still take the reader back to it.
    disposables.push(paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null }))
    setTaskLookup((taskId) => (taskId === 'task-1' ? ({ id: 'task-1', links: [] } as unknown as Task) : undefined))
    setActiveTaskId('task-1')
    setSelectedSource('pulls')
    const navigate = vi.fn()
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item, taskId: 'task-1', navigate })
    expect(navigate).toHaveBeenCalledWith('/t/task-1')
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'conn-1:ENG-42' })
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
  // The one verb whose effect lands inside a plugin. Fire-and-forget by design: a pane nobody has open
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
    // being delivered, the verb declines there, visibly, so an author is told.
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

// The answer, added on 2026-09-03 so a command can be awaited: every click site still discards the
// promise and still gets its toast, and the palette gets a result it can keep its frame open with
// (docs/future/command-palette/phase-2-search-and-input.md § Migration steps).
describe('the answer a verb gives back', () => {
  it('waits for the node before saying an action worked', async () => {
    const answered = runChromeAction({ verb: 'runNodeAction', path: '/v2/p/database/run' }, {
      pluginId: 'database', nodeId: 'node-a', item,
    })
    expect(sendRaw).toHaveBeenCalledWith('/v2/p/database/run', expect.objectContaining({
      method: 'POST', nodeId: 'node-a', body: JSON.stringify({ item: 'conn-1:ENG-42' }),
    }))
    expect(await answered).toEqual({ ok: true })
    expect(toasted).toEqual([])
  })

  it('carries the node’s own failure back, and still toasts it where the click was', async () => {
    sendRaw.mockResolvedValueOnce({ ok: false, status: 409, error: { code: 'busy', message: 'a query is already running' } })
    const result = await runChromeAction({ verb: 'runNodeAction', path: '/v2/p/database/run' }, {
      pluginId: 'database', nodeId: 'node-a',
    })
    expect(result).toEqual({ ok: false, message: 'action failed: a query is already running' })
    // The old click sites read nothing and are unchanged: this is still how they report it.
    expect(toasted).toEqual(['database: action failed'])
  })

  it('carries a thrown transport failure back too', async () => {
    sendRaw.mockRejectedValueOnce(new Error('This node is offline, so nothing was sent.'))
    const result = await runChromeAction({ verb: 'runNodeAction', path: '/v2/p/database/run' }, {
      pluginId: 'database', nodeId: 'node-a',
    })
    expect(result).toEqual({ ok: false, message: 'action failed: This node is offline, so nothing was sent.' })
  })

  it('refuses a path outside the plugin’s namespace without asking the node', async () => {
    const result = await runChromeAction({ verb: 'runNodeAction', path: '/v2/tasks' }, {
      pluginId: 'database', nodeId: 'node-a',
    })
    expect(sendRaw).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, message: 'refused an action outside its own namespace' })
  })

  it('says which refusal it was, for the frame that has to show one', async () => {
    setActiveTaskId(null)
    disposables.push(paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null }))
    const result = await runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a' })
    expect(result).toEqual({
      ok: false,
      message: 'open a task first: This opens a pane, and a pane belongs to a task.',
    })
  })
})
