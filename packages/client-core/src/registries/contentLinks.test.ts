import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumePaneIntent, evictPendingIntents } from './clientEvents'
import { openPluginContentTarget } from './contentLinks'
import { paneRegistry } from './panes'
import type { Disposable } from './registry'

// The pane has to be REGISTERED for a target to resolve into it, so the suite registers one. Before that
// check existed the intent was dispatched blind, which put a pane id nothing could render into the task's
// persisted layout — the shape a project-scoped plugin surface would hit on every content link.
let pane: Disposable
beforeEach(() => {
  pane = paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null })
})

afterEach(() => {
  pane.dispose()
  evictPendingIntents('task-1')
})

describe('declarative content-link resolution', () => {
  it('opens the declared pane and retains the captured item as its selection', () => {
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board', item: 'ENG-42' }, 'task-1')).toBe(true)
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })
  })

  it('leaves malformed or taskless targets for the browser', () => {
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board' }, 'task-1')).toBe(false)
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board', item: 'ENG-42' }, null)).toBe(false)
  })

  it('leaves a target naming something that is not a task pane for the browser', () => {
    // A surface that is not in the pane registry: not installed here, refused by this device, or
    // project-scoped and therefore living in the project-surface registry instead.
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board-card', item: 'ENG-42' }, 'task-1')).toBe(false)
    expect(consumePaneIntent('task-1', 'board-card')).toBeUndefined()
  })
})
