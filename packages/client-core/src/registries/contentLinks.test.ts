import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumePaneIntent, evictPendingIntents } from './clientEvents'
import { contentLinkRegistry, openContentTarget, openPluginContentTarget, parseInAppTarget } from './contentLinks'
import { paneRegistry } from './panes'
import { activeRefPanel, closeRefPanel, refPanelRegistry } from './refPanels'
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
  closeRefPanel()
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

describe('the provider stamp on a parsed target', () => {
  // `parse` is plugin-supplied code returning an open record, so `providerId` — the one field that decides
  // which plugin's reference panel a link can open — is the registry's to write and never the recogniser's.
  it('stamps the contributing plugin, overwriting whatever the recogniser claimed', () => {
    const board = contentLinkRegistry.register({
      id: 'board.card',
      providerId: 'board',
      // A recogniser trying to pass itself off as linear.
      parse: () => ({ kind: 'board.card', providerId: 'linear', item: 'ENG-42' }),
    })

    expect(parseInAppTarget('https://board.example/c/1')).toEqual({ kind: 'board.card', providerId: 'board', item: 'ENG-42' })
    board.dispose()
  })

  it('strips a claim from a recogniser that declared no provider at all', () => {
    const anon = contentLinkRegistry.register({ id: 'anon.card', parse: () => ({ kind: 'anon.card', providerId: 'linear', item: 'ENG-42' }) })

    expect(parseInAppTarget('https://anon.example/c/1')?.providerId).toBeUndefined()
    anon.dispose()
  })
})

describe('the host ladder', () => {
  let panel: Disposable
  beforeEach(() => {
    panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })
  })
  afterEach(() => panel.dispose())

  const target = { kind: 'board.card', providerId: 'board', pane: 'board', item: 'ENG-42' }

  it('prefers the pane by default, which is what a note and an agent transcript have always done', () => {
    expect(openContentTarget(target, { taskId: 'task-1' })).toBe('pane')
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })
    expect(activeRefPanel()).toBeNull()
  })

  it('falls to the reference panel when there is no task to open a pane in', () => {
    // Classic browse and a rail source have no task. Before the panel rung this was the end of the ladder.
    expect(openContentTarget(target, { taskId: null })).toBe('refPanel')
    expect(activeRefPanel()).toEqual({ providerId: 'board', displayId: 'ENG-42' })
  })

  it('prefers the reference panel when the clicking surface asks for it, task or no task', () => {
    expect(openContentTarget(target, { taskId: 'task-1', prefer: 'refPanel' })).toBe('refPanel')
    expect(activeRefPanel()).toEqual({ providerId: 'board', displayId: 'ENG-42' })
    expect(consumePaneIntent('task-1', 'board')).toBeUndefined()
  })

  it('falls back to the pane when the preferred panel is not installed here', () => {
    panel.dispose()
    expect(openContentTarget(target, { taskId: 'task-1', prefer: 'refPanel' })).toBe('pane')
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })
    // Re-registered so the shared afterEach dispose stays valid.
    panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })
  })

  it('refuses a panel for a provider this device has none for, and says so', () => {
    // The other half of the ownership check: a target may name any provider, and only a provider with a
    // REGISTERED panel gets one. A panel may only be registered under its own plugin's name
    // (registries/plugin.ts § declaredProvider, and the manifest twin in plugins/frames/register.tsx), so
    // naming a stranger here can never produce a panel.
    const stranger = { kind: 'board.card', providerId: 'not-installed', item: 'ENG-42' }
    expect(openContentTarget(stranger, { taskId: 'task-1', prefer: 'refPanel' })).toBe('external')
    expect(activeRefPanel()).toBeNull()
  })

  it('reports external when neither rung can take the target', () => {
    // The deliberate browser fall-through. It is a NAMED outcome rather than a false, because the boolean
    // it replaced is how `preventDefault` came to be reachable from branches that had not handled anything.
    expect(openContentTarget({ kind: 'github.pull-request', owner: 'runn', repo: 'acorn' }, { taskId: 'task-1' })).toBe('external')
    expect(activeRefPanel()).toBeNull()
  })
})
