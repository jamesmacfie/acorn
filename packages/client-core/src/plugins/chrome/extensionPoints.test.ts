import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow, type PluginContributions } from '@acorn/protocol/api.ts'

const readJson = vi.fn()
const sendRaw = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }))
const writeJson = vi.fn()
vi.mock('../../apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: (...args: unknown[]) => writeJson(...args),
}))

const { setActiveNode } = await import('../../node/activeNode')
const { extensionDeliveries, extensionPointFor, extensionPointRegistry, extensionRegistry } =
  await import('../../registries/extensionPoints')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../distribution')
const { _resetChromeContributions, syncChromeContributions } = await import('./register')

// The cooperative cross-plugin seam, end to end through the pass that builds it. Pins the four
// promises and the one refusal docs/plugins.md § Cooperative extension points describes: the host
// mints both names, the host stamps provenance, an unmatched contribution is quiet, both ends must be
// live, and B cannot reach past its own routes.

const HASH = 'a'.repeat(64)

const row = (name: string, declared: Partial<PluginContributions> = {}, over: Partial<NodePluginRow> = {}): NodePluginRow => ({
  name,
  required: false,
  disabled: false,
  running: true,
  state: 'active',
  installed: {
    version: '1.0.0',
    apiVersion: PLUGIN_API_MAJOR,
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
    contributions: { frames: [], ...declared },
    client: null,
  },
  ...over,
})

// The host: a plugin with a pane and a point drawn under it.
const HOST_PLUGIN: Partial<PluginContributions> = {
  frames: [{ target: 'pane', id: 'board', label: 'Board', glyph: 'kanban', order: 500, formFactor: ['desktop'] }],
  extensionPoints: [{ id: 'card-links', label: 'Linked items', location: 'pane.footer', surface: 'board' }],
}

// The guest: a plugin that fills the host's point from a route of its own.
const GUEST_PLUGIN: Partial<PluginContributions> = {
  extensions: [{
    id: 'board-issues',
    point: 'board:card-links',
    label: 'Linear issues',
    order: 500,
    items: '/v2/p/tracker/board-issues',
    onSelect: { verb: 'runNodeAction', path: '/v2/p/tracker/open' },
  }],
}

const pointIds = () => extensionPointRegistry.entries().map((entry) => entry.id)
const extensionIds = () => extensionRegistry.entries().map((entry) => entry.id)

beforeEach(() => {
  readJson.mockReset()
  writeJson.mockReset()
  sendRaw.mockClear()
  setActiveNode('node-a')
})

afterEach(() => {
  _resetChromeContributions()
  _resetPluginDistribution()
  setActiveNode(null)
})

describe('cooperative extension points', () => {
  it('delivers a contribution to a declared point with the host-minted name and provenance', () => {
    _seedPluginDistribution([['node-a', [row('board', HOST_PLUGIN), row('tracker', GUEST_PLUGIN)]]])
    syncChromeContributions()

    // Both names are the host's. Neither manifest could have stated either.
    expect(pointIds()).toEqual(['board:card-links'])
    expect(extensionIds()).toEqual(['plugin:tracker:board-issues'])

    const delivered = extensionDeliveries('board:card-links')
    expect(delivered.map((entry) => entry.pluginId)).toEqual(['tracker'])
    expect(delivered[0]!.label).toBe('Linear issues')
    // The point is addressable by the surface it hangs off, which is what the pane host looks it up by.
    expect(extensionPointFor('board', 'board', 'pane.footer')?.id).toBe('board:card-links')
  })

  it('reads the contributor’s own route, and delivers what it answered', async () => {
    _seedPluginDistribution([['node-a', [row('board', HOST_PLUGIN), row('tracker', GUEST_PLUGIN)]]])
    syncChromeContributions()
    readJson.mockResolvedValue({
      items: [
        { id: 'ACO-1', title: 'Fix the thing', subtitle: 'in review', badge: '3' },
        // A malformed row loses itself, not the section. The host is drawing this inside somebody else's
        // pane, and blanking a reserved strip over one bad row is the worse failure.
        { id: 'ACO-2' },
      ],
    })

    const items = await extensionDeliveries('board:card-links')[0]!.fetch(new AbortController().signal)
    expect(readJson).toHaveBeenCalledWith('/v2/p/tracker/board-issues', expect.objectContaining({ nodeId: 'node-a' }))
    expect(items).toEqual([{ id: 'ACO-1', title: 'Fix the thing', subtitle: 'in review', badge: '3' }])
  })

  it('delivers nothing when the point was never declared', () => {
    // The guest alone. Its contribution still registers: a point comes from another manifest in a pass
    // whose order nobody controls, so refusing here would make delivery depend on roster order. It
    // simply has nowhere to go.
    _seedPluginDistribution([['node-a', [row('tracker', GUEST_PLUGIN)]]])
    syncChromeContributions()
    expect(extensionIds()).toEqual(['plugin:tracker:board-issues'])
    expect(extensionDeliveries('board:card-links')).toEqual([])
  })

  it('delivers nothing when the point’s owner dropped it in an update', () => {
    _seedPluginDistribution([['node-a', [row('board', {
      frames: HOST_PLUGIN.frames!,
      // Same plugin, same pane, no point any more.
      extensionPoints: [],
    }), row('tracker', GUEST_PLUGIN)]]])
    syncChromeContributions()
    expect(pointIds()).toEqual([])
    expect(extensionDeliveries('board:card-links')).toEqual([])
  })

  it('delivers nothing when either side is disabled on the node being looked at', () => {
    _seedPluginDistribution([['node-a', [
      row('board', HOST_PLUGIN, { disabled: true, running: false }),
      row('tracker', GUEST_PLUGIN),
    ]]])
    syncChromeContributions()
    // Both rows are registered (the roster still describes them), and the gate is at delivery.
    expect(pointIds()).toEqual(['board:card-links'])
    expect(extensionDeliveries('board:card-links')).toEqual([])

    _resetChromeContributions()
    _seedPluginDistribution([['node-a', [
      row('board', HOST_PLUGIN),
      row('tracker', GUEST_PLUGIN, { disabled: true, running: false }),
    ]]])
    syncChromeContributions()
    expect(extensionDeliveries('board:card-links')).toEqual([])
  })

  it('delivers nothing when the host’s bundle was never accepted on this device', () => {
    // A package with a client half this device has not been cleared to run contributes no chrome at all,
    // which includes the point it opened. So its guest has nowhere to land, and finds that out silently.
    _seedPluginDistribution([['node-a', [
      row('board', HOST_PLUGIN, { installed: { ...row('board', HOST_PLUGIN).installed!, client: { hash: HASH, bytes: 12 } } }),
      row('tracker', GUEST_PLUGIN),
    ]]])
    syncChromeContributions()
    expect(pointIds()).toEqual([])
    expect(extensionDeliveries('board:card-links')).toEqual([])
  })

  it('refuses a contribution that would read another plugin’s namespace', () => {
    _seedPluginDistribution([['node-a', [row('board', HOST_PLUGIN), row('tracker', {
      extensions: [{
        id: 'board-issues',
        point: 'board:card-links',
        label: 'Linear issues',
        order: 500,
        // The point owner's namespace. This is the shape of "read another plugin's routes", and it is
        // refused by the same confinement every descriptor route gets.
        items: '/v2/p/board/cards',
      }],
    })]]])
    syncChromeContributions()
    expect(extensionIds()).toEqual([])
    expect(extensionDeliveries('board:card-links')).toEqual([])
  })

  it('refuses a contribution whose point reference is not a reference', () => {
    _seedPluginDistribution([['node-a', [row('board', HOST_PLUGIN), row('tracker', {
      extensions: [{ id: 'loose', point: 'card-links', label: 'Loose', order: 500, items: '/v2/p/tracker/x' }],
    })]]])
    syncChromeContributions()
    expect(extensionIds()).toEqual([])
  })

  it('refuses a point hung off a surface its own manifest does not declare', () => {
    _seedPluginDistribution([['node-a', [row('board', {
      frames: HOST_PLUGIN.frames!,
      extensionPoints: [{ id: 'ghost', label: 'Ghost', location: 'pane.footer', surface: 'not-a-surface' }],
    })]]])
    syncChromeContributions()
    expect(pointIds()).toEqual([])
  })

  it('refuses a point at a location this shell has no host for', () => {
    // The version-skew case: a newer node describing a location this client cannot draw. Refused loudly
    // enough for an author to see, rather than coerced into the one location that does exist.
    _seedPluginDistribution([['node-a', [row('board', {
      frames: HOST_PLUGIN.frames!,
      extensionPoints: [{ id: 'future', label: 'Future', location: 'pane.header', surface: 'board' }],
    })]]])
    syncChromeContributions()
    expect(pointIds()).toEqual([])
  })

  it('drops an onSelect the device cannot honour rather than registering a row that can only fail', () => {
    _seedPluginDistribution([['node-a', [row('board', HOST_PLUGIN), row('tracker', {
      extensions: [{
        id: 'board-issues',
        point: 'board:card-links',
        label: 'Linear issues',
        order: 500,
        items: '/v2/p/tracker/board-issues',
        // Another plugin's route behind the verb.
        onSelect: { verb: 'runNodeAction', path: '/v2/p/board/open' },
      }],
    })]]])
    syncChromeContributions()
    expect(extensionIds()).toEqual([])
  })

  it('orders deliveries by order then id, never by which plugin registered first', () => {
    _seedPluginDistribution([['node-a', [
      row('board', HOST_PLUGIN),
      row('zeta', { extensions: [{ id: 'a', point: 'board:card-links', label: 'Zeta', order: 10, items: '/v2/p/zeta/i' }] }),
      row('alpha', { extensions: [{ id: 'a', point: 'board:card-links', label: 'Alpha', order: 20, items: '/v2/p/alpha/i' }] }),
    ]]])
    syncChromeContributions()
    expect(extensionDeliveries('board:card-links').map((entry) => entry.pluginId)).toEqual(['zeta', 'alpha'])
  })

  it('disposes then registers on a re-sync, so a reload does not double a point or its contribution', () => {
    _seedPluginDistribution([['node-a', [row('board', HOST_PLUGIN), row('tracker', GUEST_PLUGIN)]]])
    syncChromeContributions()
    // The `plugins:changed` path: the same pass runs again against the same roster.
    syncChromeContributions()
    expect(pointIds()).toEqual(['board:card-links'])
    expect(extensionIds()).toEqual(['plugin:tracker:board-issues'])
    expect(extensionDeliveries('board:card-links')).toHaveLength(1)
  })
})
