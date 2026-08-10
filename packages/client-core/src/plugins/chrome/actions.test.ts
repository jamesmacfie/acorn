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
const { consumePaneIntent, evictPendingIntents } = await import('../../registries/clientEvents')
const { setActiveTaskId } = await import('../../tasks/tasks')

// The two verbs that decide WHERE a rail row's detail appears, which is the one thing the descriptor tier
// could not previously express. They are disjoint by manifest rule, and this pins the runtime half of that:
// `openPane` still refuses without a task, `navigate` never needs one.

const item = { id: 'conn-1:ENG-42', title: 'Fix the thing' }
const disposables: { dispose(): void }[] = []

afterEach(() => {
  for (const entry of disposables.splice(0).reverse()) entry.dispose()
  evictPendingIntents('task-1')
  setActiveTaskId(null)
})

describe('openPane', () => {
  it('opens a task pane with the clicked row retained as its selection', () => {
    disposables.push(paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null }))
    setActiveTaskId('task-1')
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item })
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'conn-1:ENG-42' })
  })

  it('still refuses when there is no task, because a task pane has nowhere else to go', () => {
    runChromeAction({ verb: 'openPane', pane: 'board' }, { pluginId: 'board', nodeId: 'node-a', item })
    expect(consumePaneIntent('', 'board')).toBeUndefined()
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
