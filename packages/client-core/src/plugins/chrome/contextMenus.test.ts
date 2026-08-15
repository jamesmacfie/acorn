import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginContextMenuDescriptor } from '@acorn/protocol/pluginContract.ts'
// Type-only, so it is erased and does not evaluate the module before the mock below is installed.
import type { TaskRowTarget } from '../../registries/contextMenus'

const sendRaw = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }))
vi.mock('../../apiClient', () => ({
  readJson: vi.fn(),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: vi.fn(),
}))

const { contextMenuItems, contextMenuRegistry } = await import('../../registries/contextMenus')
const { pluginContextMenuId, pluginContextMenuItem, registerPluginContextMenu } = await import('./contextMenus')

// A plugin's menu row: what the host refuses, and what it binds over whatever the manifest said. The
// node checked all of this at parse time; a roster row is bytes a node sent, so it is checked again.

const target = (over: Partial<TaskRowTarget> = {}): TaskRowTarget => ({
  location: 'task.row',
  id: 't1',
  title: 'Ship it',
  origin: 'github',
  projectId: 'p1',
  pinned: false,
  branch: 'me/ship-it',
  ...over,
})

const descriptor = (over: Partial<PluginContextMenuDescriptor> = {}): PluginContextMenuDescriptor => ({
  id: 'open-card',
  location: 'task.row',
  label: 'Open the board card',
  order: 500,
  action: { verb: 'runNodeAction', path: '/v2/p/board/open' },
  ...over,
})

const binding = (over: Partial<{ nodeId: () => string; enabled: () => boolean }> = {}) => ({
  nodeId: () => 'node-a',
  enabled: () => true,
  ...over,
})

const disposables: { dispose(): void }[] = []
afterEach(() => {
  while (disposables.length) disposables.pop()!.dispose()
  sendRaw.mockClear()
})

describe('what the host refuses', () => {
  it('refuses a location this shell does not have', () => {
    // The version-skew case, and the reason `location` is a plain string on the wire: a newer node can
    // describe a location this client cannot draw, and the answer is a named refusal rather than a row
    // registered against nothing.
    expect(() => pluginContextMenuItem('board', descriptor({ location: 'file.row' }), binding()))
      .toThrow(/unknown location 'file.row'/)
    expect(() => pluginContextMenuItem('board', descriptor({ location: '' }), binding())).toThrow(/unknown location/)
  })

  it('refuses a `when` naming a fact the location does not have', () => {
    // Including the identity fields, which the target genuinely carries: they are deliberately not
    // facts, so matching on one would be a menu row keyed to a single task.
    expect(() => pluginContextMenuItem('board', descriptor({ when: { branch: 'main' } }), binding()))
      .toThrow(/does not have: branch/)
    expect(() => pluginContextMenuItem('board', descriptor({ when: { id: 't1' } }), binding()))
      .toThrow(/does not have: id/)
    expect(() => pluginContextMenuItem('board', descriptor({ when: { origin: 'github', title: 'x' } }), binding()))
      .toThrow(/does not have: title/)
  })

  it('accepts the facts the location does have', () => {
    expect(pluginContextMenuItem('board', descriptor({ when: { origin: 'github', pinned: true, projectId: 'p1' } }), binding()).id)
      .toBe('plugin:board:open-card')
  })
})

describe('what the host binds', () => {
  it('namespaces the id with its owner, so it cannot take a core row’s place', () => {
    expect(pluginContextMenuId('board', 'open-card')).toBe('plugin:board:open-card')
    const first = pluginContextMenuItem('board', descriptor(), binding())
    const second = pluginContextMenuItem('other', descriptor(), binding())
    expect([first.id, second.id]).toEqual(['plugin:board:open-card', 'plugin:other:open-card'])
  })

  it('hides the row whenever the plugin is not running on the node being looked at', () => {
    let running = true
    const entry = pluginContextMenuItem('board', descriptor(), binding({ enabled: () => running }))
    expect(entry.when!(target())).toBe(true)
    running = false
    expect(entry.when!(target())).toBe(false)
  })

  it('ANDs the enablement gate with the declared predicate', () => {
    const entry = pluginContextMenuItem('board', descriptor({ when: { origin: 'github' } }), binding())
    expect(entry.when!(target({ origin: 'github' }))).toBe(true)
    expect(entry.when!(target({ origin: 'local' }))).toBe(false)
  })

  it('sends the verb the id of the thing that was right-clicked, and nothing the descriptor chose', async () => {
    const entry = pluginContextMenuItem('board', descriptor(), binding())
    entry.run(target({ id: 'task-42' }))
    await Promise.resolve()
    expect(sendRaw).toHaveBeenCalledWith('/v2/p/board/open', expect.objectContaining({
      method: 'POST',
      nodeId: 'node-a',
      body: JSON.stringify({ item: 'task-42' }),
    }))
  })

  it('carries no tone: a red row is core’s claim about core’s resources', () => {
    expect(pluginContextMenuItem('board', descriptor(), binding()).tone).toBeUndefined()
  })
})

describe('registering one', () => {
  it('lands in the same list core’s rows come from', () => {
    disposables.push(registerPluginContextMenu('board', descriptor(), binding()))
    expect(contextMenuItems('task.row', target()).map((entry) => entry.id)).toEqual(['plugin:board:open-card'])
  })

  it('takes the row with it on dispose', () => {
    const entry = registerPluginContextMenu('board', descriptor(), binding())
    entry.dispose()
    expect(contextMenuRegistry.entries()).toEqual([])
  })
})
