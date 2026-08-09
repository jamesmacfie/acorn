import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodePluginRow, PluginContributions } from '@acorn/protocol/api.ts'

const readJson = vi.fn()
vi.mock('../../apiClient', () => ({ readJson: (...args: unknown[]) => readJson(...args), sendRaw: vi.fn() }))

const { setActiveNode } = await import('../../node/activeNode')
const { attentionRegistry } = await import('../../registries/attention')
const { nodeStatRegistry } = await import('../../registries/nodeStats')
const { paletteRowRegistry } = await import('../../registries/paletteRows')
const { sourceRegistry } = await import('../../registries/sources')
const { taskSlotRegistry } = await import('../../registries/slots')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../distribution')
const { _resetChromeContributions, syncChromeContributions } = await import('./register')

// The chrome host pass (docs/third-party/phase-4-declarative-chrome.md § Host adapters).
//
// What is worth pinning is the pass's CONTRACT rather than the descriptors themselves: the trust gate
// (which is different from the frame host's, deliberately), per-node presence, dispose-then-register,
// and that a plugin route's answer can be garbage without the shell noticing.

const HASH = 'a'.repeat(64)

const contributions = (over: Partial<PluginContributions> = {}): PluginContributions => ({ frames: [], ...over })

const row = (name: string, over: Partial<NodePluginRow> = {}, declared: Partial<PluginContributions> = {}): NodePluginRow => ({
  name,
  required: false,
  disabled: false,
  running: true,
  state: 'active',
  installed: {
    version: '1.0.0',
    apiVersion: '1',
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
    contributions: contributions(declared),
    client: null,
  },
  ...over,
})

const CHROME: Partial<PluginContributions> = {
  sources: [{ id: 'board', label: 'Board', glyph: 'kanban', order: 60, items: '/v2/p/board/rail-items' }],
  slots: [{ id: 'board-footer', slot: 'footer', data: '/v2/p/board/badge' }],
  palette: [{ id: 'board.new', title: 'Board: new card', action: { verb: 'runNodeAction', path: '/v2/p/board/new' } }],
  attention: [{ id: 'board-stuck', order: 500, items: '/v2/p/board/attention' }],
  nodeStats: [{ id: 'board-count', order: 500, label: ['card stuck', 'cards stuck'], data: '/v2/p/board/stat' }],
}

const ids = () => ({
  sources: sourceRegistry.entries().map((entry) => entry.id),
  slots: taskSlotRegistry.entries().map((entry) => entry.id),
  palette: paletteRowRegistry.entries().map((entry) => entry.id),
  attention: attentionRegistry.entries().map((entry) => entry.id),
  nodeStats: nodeStatRegistry.entries().map((entry) => entry.id),
})

beforeEach(() => {
  readJson.mockReset()
  setActiveNode('node-a')
})

afterEach(() => {
  _resetChromeContributions()
  _resetPluginDistribution()
  setActiveNode(null)
})

describe('syncChromeContributions', () => {
  it('registers every descriptor kind for a plugin that ships no client bundle at all', () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
    syncChromeContributions()
    expect(ids()).toEqual({
      sources: ['board'],
      slots: ['board-footer'],
      palette: ['plugin-chrome:board'],
      attention: ['board-stuck'],
      nodeStats: ['board-count'],
    })
  })

  it('replaces rather than duplicates on a second pass', () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
    syncChromeContributions()
    // The registries throw on a duplicate id, so a pass that failed to dispose would not merely
    // double the list — it would take the plugin's chrome away entirely.
    syncChromeContributions()
    expect(ids().sources).toEqual(['board'])
    expect(ids().attention).toEqual(['board-stuck'])
  })

  it('contributes nothing for a plugin whose bundle this device has not accepted', () => {
    const withBundle = row('board', {}, CHROME)
    withBundle.installed!.client = { hash: HASH, bytes: 12 }
    _seedPluginDistribution([['node-a', [withBundle]]])
    syncChromeContributions()
    expect(ids().sources).toEqual([])

    // …and everything once it has. Chrome is data, but a plugin whose CODE the owner declined does not
    // get to decorate the shell — its panes were never registered, so its `openPane` could not land.
    _seedPluginDistribution([['node-a', [withBundle]]], [`board ${HASH}`])
    syncChromeContributions()
    expect(ids().sources).toEqual(['board'])
  })

  it('gates the rail source on the plugin running on the node being looked at', () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
    syncChromeContributions()
    const source = sourceRegistry.get('board')!
    expect(source.when!()).toBe(true)
    setActiveNode('node-b')
    expect(source.when!()).toBe(false)
  })

  it('asks a node that does not run the plugin for nothing', async () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
    syncChromeContributions()
    const signal = new AbortController().signal
    expect(await attentionRegistry.get('board-stuck')!.fetch('node-b', signal)).toEqual([])
    // `0` is what Fleet home hides, which is the right answer for "this node does not run it".
    expect(await nodeStatRegistry.get('board-count')!.fetch('node-b', signal)).toBe(0)
    expect(readJson).not.toHaveBeenCalled()
  })

  it('namespaces attention ids and drops malformed rows without throwing', async () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
    syncChromeContributions()
    readJson.mockResolvedValue({
      items: [
        { id: 'card-1', title: 'Stuck', severity: 'warn', at: 5 },
        { id: 'card-2', title: 'No severity', at: 6 },
        'not an object',
      ],
    })
    const items = await attentionRegistry.get('board-stuck')!.fetch('node-a', new AbortController().signal)
    expect(items).toEqual([{ id: 'board-stuck:card-1', title: 'Stuck', severity: 'warn', at: 5 }])
  })

  it('refuses to read a route outside the plugin’s own namespace', async () => {
    const hostile: Partial<PluginContributions> = { attention: [{ id: 'a', order: 500, items: '/v2/core/tasks' }] }
    _seedPluginDistribution([['node-a', [row('board', {}, hostile)]]])
    syncChromeContributions()
    // The node's parser already rejected this — but the manifest reaches the device as a roster row,
    // and a roster row is bytes a node sent.
    await expect(attentionRegistry.get('a')!.fetch('node-a', new AbortController().signal)).rejects.toThrow(/may not read/)
    expect(readJson).not.toHaveBeenCalled()
  })

  it('offers palette rows only while the plugin is present on the node in view', async () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
    syncChromeContributions()
    const palette = paletteRowRegistry.get('plugin-chrome:board')!
    expect((await palette.rows(null)).rows).toEqual([{ kind: 'plugin', id: 'board.new', label: 'Board: new card' }])
    setActiveNode('node-b')
    expect((await palette.rows(null)).rows).toEqual([])
  })

  it('keeps one plugin’s bad descriptor from costing it the rest of its chrome', () => {
    const clash = sourceRegistry.register({ id: 'board', order: 1, glyph: 'x', label: 'Core board' })
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
    syncChromeContributions()
    expect(ids().sources).toEqual(['board'])
    expect(sourceRegistry.get('board')!.label).toBe('Core board')
    // The colliding source is gone; everything else the manifest declared is still there.
    expect(ids().slots).toEqual(['board-footer'])
    expect(ids().nodeStats).toEqual(['board-count'])
    clash.dispose()
  })

  it('takes all of a plugin’s chrome away when it stops being offered', () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
    syncChromeContributions()
    _seedPluginDistribution([['node-a', []]])
    syncChromeContributions()
    expect(ids()).toEqual({ sources: [], slots: [], palette: [], attention: [], nodeStats: [] })
  })
})
