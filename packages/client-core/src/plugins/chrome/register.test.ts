import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow, type PluginContributions, type PluginSourceEmptyState } from '@acorn/protocol/api.ts'

const readJson = vi.fn()
const sendRaw = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }))
const writeJson = vi.fn()
vi.mock('../../apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: (...args: unknown[]) => writeJson(...args),
}))

const { MAX_AGENT_CONTEXT_BYTES } = await import('@acorn/protocol/agentContext.ts')
const { setActiveNode } = await import('../../node/activeNode')
const { agentContextRegistry } = await import('../../registries/agentContexts')
const { attentionRegistry } = await import('../../registries/attention')
const { nodeStatRegistry } = await import('../../registries/nodeStats')
const { commandAvailable, commandRegistry, executeCommand } = await import('../../registries/commands')
const { keybindingRegistry } = await import('../../registries/keybindings')
const { contentLinkRegistry, parseInAppTarget } = await import('../../registries/contentLinks')
const { refResolverRegistry } = await import('../../registries/refResolvers')
const { sourceRegistry } = await import('../../registries/sources')
const { taskSlotRegistry, uiSlotRegistry } = await import('../../registries/slots')
const { contextMenuItems, contextMenuRegistry } = await import('../../registries/contextMenus')
const { orphanedPluginOverrideIds } = await import('../../settings/shortcutSettingsModel')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../distribution')
const { _resetChromeContributions, syncChromeContributions, usableEmptyState } = await import('./register')

// The chrome host pass (docs/plugins.md).
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
    // The real constant: a literal here fails the day PLUGIN_API_MAJOR moves, for no reason this file is about.
    apiVersion: PLUGIN_API_MAJOR,
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
    contributions: contributions(declared),
    client: null,
  },
  ...over,
})

const CHROME: Partial<PluginContributions> = {
  sources: [{ id: 'board', label: 'Board', glyph: 'kanban', order: 60, items: '/v2/p/board/rail-items' }],
  slots: [
    { id: 'board-footer', slot: 'footer', data: '/v2/p/board/badge' },
    { id: 'board-status', slot: 'topbar', data: '/v2/p/board/status' },
  ],
  contextMenus: [{
    id: 'board-open', location: 'task.row', label: 'Open the board card', order: 500,
    action: { verb: 'runNodeAction', path: '/v2/p/board/open' },
  }],
  palette: [{ id: 'board.new', title: 'Board: new card', action: { verb: 'runNodeAction', path: '/v2/p/board/new' } }],
  attention: [{ id: 'board-stuck', order: 500, items: '/v2/p/board/attention' }],
  nodeStats: [{ id: 'board-count', order: 500, label: ['card stuck', 'cards stuck'], data: '/v2/p/board/stat' }],
  agentContexts: [{
    id: 'board-context',
    label: 'Board cards',
    options: '/v2/p/board/context-options',
    capture: '/v2/p/board/context-capture',
  }],
  refResolvers: [{ id: 'board-refs', kind: 'board.card', resolve: '/v2/p/board/refs' }],
}

const ids = () => ({
  sources: sourceRegistry.entries().map((entry) => entry.id),
  slots: taskSlotRegistry.entries().map((entry) => entry.id),
  shellSlots: uiSlotRegistry.entries().map((entry) => entry.id),
  contextMenus: contextMenuRegistry.entries().map((entry) => entry.id),
  commands: commandRegistry.entries().filter((entry) => entry.id.startsWith('plugin.')).map((entry) => entry.id),
  keybindings: keybindingRegistry.entries().filter((entry) => entry.id.startsWith('plugin.')).map((entry) => entry.id),
  attention: attentionRegistry.entries().map((entry) => entry.id),
  nodeStats: nodeStatRegistry.entries().map((entry) => entry.id),
  agentContexts: agentContextRegistry.entries().map((entry) => entry.id),
  refResolvers: refResolverRegistry.entries().map((entry) => entry.id),
})

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

describe('syncChromeContributions', () => {
  it('registers every descriptor kind for a plugin that ships no client bundle at all', () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
    syncChromeContributions()
    expect(ids()).toEqual({
      sources: ['board'],
      slots: ['board-footer'],
      shellSlots: ['board-status'],
      contextMenus: ['plugin:board:board-open'],
      commands: ['plugin.board.board.new'],
      keybindings: [],
      attention: ['board-stuck'],
      nodeStats: ['board-count'],
      agentContexts: ['board-context'],
      refResolvers: ['board-refs'],
    })
  })

  it('keeps an empty state’s message but drops an action the device cannot honour', () => {
    // A roster row is wire input, so the empty state's action is re-checked here exactly as a command's
    // is — the node's parse is not evidence about the bytes that arrived. Dropping the action rather
    // than the whole state is deliberate: the sentence is the part the rail was missing.
    const message = 'No boards linked yet.'
    const authored = (action: PluginSourceEmptyState['action']): PluginSourceEmptyState =>
      ({ message, action, actionLabel: 'Link one' })
    const panes = { panes: new Set(['board']), projectPanes: new Set<string>(), overlays: new Set(['board-picker']) }

    // Another plugin's route, a pane this manifest never declared, and a verb that needs a row.
    expect(usableEmptyState('board', panes, authored({ verb: 'runNodeAction', path: '/v2/p/other/go' }))).toEqual({ message })
    expect(usableEmptyState('board', panes, authored({ verb: 'openPane', pane: 'ghost' }))).toEqual({ message })
    expect(usableEmptyState('board', panes, authored({ verb: 'openUrl', url: 'http://example.com' }))).toEqual({ message })
    expect(usableEmptyState('board', panes, authored({ verb: 'createTask' } as never))).toEqual({ message })
    // An overlay is its own set: `openPane` cannot name one, and `openOverlay` cannot name a pane.
    expect(usableEmptyState('board', panes, authored({ verb: 'openOverlay', overlay: 'board' }))).toEqual({ message })
    expect(usableEmptyState('board', panes, authored({ verb: 'openPane', pane: 'board-picker' }))).toEqual({ message })

    const usable = authored({ verb: 'runNodeAction', path: '/v2/p/board/link' })
    expect(usableEmptyState('board', panes, usable)).toBe(usable)
    const picker = authored({ verb: 'openOverlay', overlay: 'board-picker' })
    expect(usableEmptyState('board', panes, picker)).toBe(picker)
    expect(usableEmptyState('board', panes, { message })).toEqual({ message })
    expect(usableEmptyState('board', panes, undefined)).toBeUndefined()
  })

  it('registers host-owned promotion for a createTask source', () => {
    const promotable: Partial<PluginContributions> = {
      sources: [{
        id: 'board', label: 'Board', glyph: 'kanban', order: 60,
        items: '/v2/p/board/rail-items', onSelect: { verb: 'createTask' },
      }],
    }
    _seedPluginDistribution([['node-a', [row('board', {}, promotable)]]])
    syncChromeContributions()
    expect(sourceRegistry.get('board')?.promotion).toBeDefined()
  })

  it('registers host-owned promotion independently of the row selection action', () => {
    const promotable: Partial<PluginContributions> = {
      frames: [{ target: 'pane', id: 'board-pane', label: 'Board', glyph: 'kanban', order: 60, formFactor: ['desktop'] }],
      sources: [{
        id: 'board', label: 'Board', glyph: 'kanban', order: 60,
        items: '/v2/p/board/rail-items', onSelect: { verb: 'openPane', pane: 'board-pane' },
      }],
    }
    _seedPluginDistribution([['node-a', [row('board', {}, promotable)]]])
    syncChromeContributions()
    expect(sourceRegistry.get('board')?.promotion).toBeDefined()
  })

  it('registers declarative content links in manifest order and disposes them with the plugin', () => {
    const links = (id: string): Partial<PluginContributions> => ({
      frames: [{ target: 'pane', id: `${id}-pane`, label: id, glyph: 'puzzle', order: 500, formFactor: ['desktop'] }],
      contentLinks: [{
        id: `${id}.card`,
        match: 'https://tracker.example/cards/{key}',
        openPane: `${id}-pane`,
        item: 'key',
      }],
    })
    _seedPluginDistribution([['node-a', [row('first', {}, links('first')), row('second', {}, links('second'))]]])
    syncChromeContributions()

    expect(contentLinkRegistry.entries().map((entry) => entry.id)).toEqual(['first.card', 'second.card'])
    // `providerId` is stamped from the plugin id, which is what lets a link resolve into that plugin's own
    // reference panel — a manifest never states it, so it cannot point at another plugin's panel.
    expect(parseInAppTarget('https://tracker.example/cards/ENG-42')).toEqual({
      kind: 'first.card', key: 'ENG-42', pane: 'first-pane', item: 'ENG-42', providerId: 'first',
    })

    _seedPluginDistribution([['node-a', []]])
    syncChromeContributions()
    expect(contentLinkRegistry.entries()).toEqual([])
  })

  it('registers a content link whose only destination is the plugin reference panel', () => {
    // A plugin can have items worth glancing at and no task pane at all. `openPane` is optional for exactly
    // that shape, and the target it produces carries no `pane` — so the host's pane rung declines it and the
    // panel rung, resolved by the stamped provider, takes it.
    _seedPluginDistribution([['node-a', [row('board', {}, {
      frames: [{ target: 'refPanel', id: 'board-ref', label: 'Card', glyph: 'puzzle', order: 500, formFactor: ['desktop'], providerId: 'board' }],
      contentLinks: [{ id: 'board.card', match: 'https://board.example/cards/{key}', item: 'key' }],
    })]]])
    syncChromeContributions()

    expect(parseInAppTarget('https://board.example/cards/ENG-42')).toEqual({
      kind: 'board.card', key: 'ENG-42', item: 'ENG-42', providerId: 'board',
    })
  })

  it('contributes no content recogniser when this device rejected the plugin bundle', () => {
    const declared: Partial<PluginContributions> = {
      frames: [{ target: 'pane', id: 'board', label: 'Board', glyph: 'puzzle', order: 500, formFactor: ['desktop'] }],
      contentLinks: [{
        id: 'board.card', match: 'https://board.example/cards/{key}', openPane: 'board', item: 'key',
      }],
    }
    const withBundle = row('board', {}, declared)
    withBundle.installed!.client = { hash: HASH, bytes: 12 }
    _seedPluginDistribution([['node-a', [withBundle]]])
    syncChromeContributions()
    expect(contentLinkRegistry.entries()).toEqual([])
  })

  it('replaces rather than duplicates on a second pass', () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
    syncChromeContributions()
    // The registries throw on a duplicate id, so a pass that failed to dispose would not merely
    // double the list — it would take the plugin's chrome away entirely. The reload path calls this
    // on every `plugins:changed`, so a leaked registration shows up here as a missing contribution.
    syncChromeContributions()
    expect(ids().sources).toEqual(['board'])
    expect(ids().attention).toEqual(['board-stuck'])
    expect(ids().shellSlots).toEqual(['board-status'])
    expect(ids().contextMenus).toEqual(['plugin:board:board-open'])
  })

  it('routes each manifest slot name to its own registry and skips one it does not know', () => {
    // `footer` is a TASK slot and `topbar` a SHELL one. A roster row is bytes a node sent, so a slot
    // name from a newer schema is dropped rather than defaulted into whichever registry is handy.
    const slots: Partial<PluginContributions> = {
      slots: [
        { id: 'board-footer', slot: 'footer', data: '/v2/p/board/badge' },
        { id: 'board-status', slot: 'topbar', data: '/v2/p/board/status' },
        { id: 'board-drawer', slot: 'drawer' as never, data: '/v2/p/board/drawer' },
      ],
    }
    _seedPluginDistribution([['node-a', [row('board', {}, slots)]]])
    syncChromeContributions()
    expect(ids().slots).toEqual(['board-footer'])
    expect(ids().shellSlots).toEqual(['board-status'])
    expect(uiSlotRegistry.get('board-status')?.slot).toBe('topbar.right')
  })

  it('gates a topbar chip on the plugin running on the node being looked at', () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
    syncChromeContributions()
    const chip = uiSlotRegistry.get('board-status')!
    expect(chip.when!({} as never)).toBe(true)
    setActiveNode('node-b')
    expect(chip.when!({} as never)).toBe(false)
  })

  describe('context menus', () => {
    const target = {
      location: 'task.row' as const,
      id: 'task-42', title: 'Ship it', origin: 'github', projectId: 'p1', pinned: false, branch: 'me/ship',
    }

    it('offers the row on the declared location, namespaced by its owner', () => {
      _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
      syncChromeContributions()
      expect(contextMenuItems('task.row', target).map((entry) => entry.label)).toEqual(['Open the board card'])
    })

    it('drops a row whose action this device cannot honour, keeping the rest of the chrome', () => {
      // Same rule a command and an empty state get: the pane was never declared, so the row could only
      // fail. The plugin keeps its other contributions.
      const bad: Partial<PluginContributions> = {
        ...CHROME,
        contextMenus: [{
          id: 'board-open', location: 'task.row', label: 'Open', order: 500,
          action: { verb: 'openPane', pane: 'never-declared' },
        }],
      }
      _seedPluginDistribution([['node-a', [row('board', {}, bad)]]])
      syncChromeContributions()
      expect(ids().contextMenus).toEqual([])
      expect(ids().sources).toEqual(['board'])
    })

    it('drops a row naming a location or a fact this shell does not have', () => {
      const bad: Partial<PluginContributions> = {
        ...CHROME,
        contextMenus: [
          { id: 'from-the-future', location: 'file.row', label: 'Open', order: 500, action: { verb: 'runNodeAction', path: '/v2/p/board/open' } },
          { id: 'bad-when', location: 'task.row', label: 'Open', order: 500, when: { branch: 'main' }, action: { verb: 'runNodeAction', path: '/v2/p/board/open' } },
        ],
      }
      _seedPluginDistribution([['node-a', [row('board', {}, bad)]]])
      syncChromeContributions()
      expect(ids().contextMenus).toEqual([])
      expect(ids().nodeStats).toEqual(['board-count'])
    })

    it('hides the row on a node that does not run the plugin', () => {
      _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
      syncChromeContributions()
      expect(contextMenuItems('task.row', target)).toHaveLength(1)
      setActiveNode('node-b')
      expect(contextMenuItems('task.row', target)).toEqual([])
    })

    it('contributes nothing for a plugin whose bundle this device has not accepted', () => {
      const withBundle = row('board', {}, CHROME)
      withBundle.installed!.client = { hash: HASH, bytes: 12 }
      _seedPluginDistribution([['node-a', [withBundle]]])
      syncChromeContributions()
      expect(ids().contextMenus).toEqual([])
    })
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

  it('promotes the palette alias to one command and gates it on the active node', async () => {
    _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
    syncChromeContributions()
    const command = commandRegistry.get('plugin.board.board.new')!
    expect(command.palette).toBe(true)
    expect(commandAvailable(command)).toBe(true)
    await executeCommand(command.id)
    expect(sendRaw).toHaveBeenCalledWith('/v2/p/board/new', expect.objectContaining({ method: 'POST', nodeId: 'node-a' }))
    setActiveNode('node-b')
    expect(commandAvailable(command)).toBe(false)
  })

  it('registers commands and keybindings with host-qualified ids and preserves them while disabled', () => {
    const declared: Partial<PluginContributions> = {
      commands: [
        { id: 'search', title: 'Board: search', category: 'action', palette: true, action: { verb: 'runNodeAction', path: '/v2/p/board/search' } },
        { id: 'quiet', title: 'Board: quiet action', category: 'action', palette: false, action: { verb: 'openUrl', url: 'https://example.com' } },
      ],
      keybindings: [{ command: 'search', defaultChord: 'meta+shift+f', when: 'task' }],
    }
    _seedPluginDistribution([['node-a', [row('board', { running: false, disabled: true, state: 'disabled' }, declared)]]])
    syncChromeContributions()
    expect(ids().commands).toEqual(['plugin.board.search', 'plugin.board.quiet'])
    expect(commandRegistry.get('plugin.board.quiet')?.palette).toBe(false)
    const binding = keybindingRegistry.get('plugin.board.search')!
    expect(binding).toMatchObject({ command: 'plugin.board.search', category: 'board', defaultChord: 'meta+shift+f' })
    expect(binding.active?.()).toBe(false)
    expect(binding.plugin?.state()).toBe('disabled')
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

  // The one descriptor pair whose answer leaves the shell and enters an agent's prompt, so what is
  // pinned here is the trust boundary rather than the plumbing: the host binds `source`, measures the
  // bytes itself, and refuses a body it cannot parse or cannot fit.
  describe('agent contexts', () => {
    const scope = { taskId: 'task-1' }
    const snapshot = (over: Record<string, unknown> = {}) => ({
      contextId: 'board:card-1', label: 'Card 1', content: '# Card 1', ...over,
    })

    beforeEach(() => {
      _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
      syncChromeContributions()
    })

    it('reads options from the declared path with the scope as query parameters', async () => {
      readJson.mockResolvedValue([{ id: 'card-1', label: 'Card 1' }])
      const options = await agentContextRegistry.get('board-context')!.options(scope)
      expect(options).toEqual([{ id: 'card-1', label: 'Card 1' }])
      expect(readJson).toHaveBeenCalledWith('/v2/p/board/context-options?taskId=task-1', expect.objectContaining({ nodeId: 'node-a' }))
    })

    it('captures over POST and binds source, capture time and byte size host-side', async () => {
      // Everything a plugin should not be trusted with, supplied by the plugin: another plugin's
      // namespace, a pane it never declared, and a byte count that would walk past the composer's
      // ceiling if it were believed.
      writeJson.mockResolvedValue([snapshot({
        source: 'context.task',
        byteSize: 1,
        estimatedTokens: 1,
        capturedAt: 1,
        deepLink: { pane: 'someone-elses-pane' },
        resourceId: 'card-1',
        sensitivity: 'private',
      })])
      const captured = await agentContextRegistry.get('board-context')!.capture(scope, ['card-1'])
      expect(writeJson).toHaveBeenCalledWith('/v2/p/board/context-capture', expect.objectContaining({
        method: 'POST',
        nodeId: 'node-a',
        body: JSON.stringify({ taskId: 'task-1', optionIds: ['card-1'] }),
      }))
      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        type: 'context',
        source: 'board:board-context',
        contextId: 'board:board-context:board:card-1',
        resourceId: 'card-1',
        sensitivity: 'private',
        byteSize: 8,
      })
      expect(captured[0]?.deepLink).toBeUndefined()
      expect(captured[0]?.capturedAt).toBeGreaterThan(1)
    })

    it('yields no snapshots for a malformed capture body', async () => {
      for (const body of [{ items: [] }, [{ contextId: 'x', label: 'X' }], ['not an object'], null]) {
        writeJson.mockResolvedValue(body)
        expect(await agentContextRegistry.get('board-context')!.capture(scope)).toEqual([])
      }
      readJson.mockResolvedValue({ options: [] })
      expect(await agentContextRegistry.get('board-context')!.options(scope)).toEqual([])
    })

    it('rejects a capture over the shared context ceiling rather than trimming it to fit', async () => {
      writeJson.mockResolvedValue([snapshot({ content: 'x'.repeat(MAX_AGENT_CONTEXT_BYTES) }), snapshot({ contextId: 'board:card-2' })])
      await expect(agentContextRegistry.get('board-context')!.capture(scope)).rejects.toThrow(/512 KiB of context/)
    })

    it('asks a node that does not run the plugin for nothing', async () => {
      setActiveNode('node-b')
      _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
      syncChromeContributions()
      expect(await agentContextRegistry.get('board-context')!.options(scope)).toEqual([])
      expect(await agentContextRegistry.get('board-context')!.capture(scope)).toEqual([])
      expect(readJson).not.toHaveBeenCalled()
      expect(writeJson).not.toHaveBeenCalled()
    })
  })

  describe('ref resolvers', () => {
    const row1 = { identifier: 'ENG-1', label: 'Ship the thing', state: { name: 'In Progress', color: '#f2c94c', kind: 'started' } }

    beforeEach(() => {
      _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]]])
      syncChromeContributions()
    })

    it('POSTs the identifiers to the declared route and stamps the answer with the declaring plugin', async () => {
      // The row claims a provider, as a plugin's output always may. The host overwrites it, because a
      // resolver naming another provider is how its rows would end up behind that provider's panel.
      writeJson.mockResolvedValue([{ ...row1, providerId: 'linear', url: 'https://board.example/c/ENG-1' }])
      const resolved = await refResolverRegistry.get('board-refs')!.resolve(['ENG-1'])
      expect(writeJson).toHaveBeenCalledWith('/v2/p/board/refs', expect.objectContaining({
        method: 'POST',
        nodeId: 'node-a',
        body: JSON.stringify({ identifiers: ['ENG-1'] }),
      }))
      expect(resolved).toEqual([{ ...row1, url: 'https://board.example/c/ENG-1', providerId: 'board' }])
    })

    it('resolves nothing rather than partly when the answer does not parse', async () => {
      // Including the shape the route used to answer with, `{ issues: [...] }` — a wrapped body is
      // exactly what a plugin written against the old contract would send.
      for (const body of [{ issues: [row1] }, [{ identifier: 'ENG-1' }], [{ ...row1, label: 'x'.repeat(400) }], null]) {
        writeJson.mockResolvedValue(body)
        expect(await refResolverRegistry.get('board-refs')!.resolve(['ENG-1'])).toEqual([])
      }
    })

    it('asks a node that does not run the plugin for nothing', async () => {
      setActiveNode('node-b')
      _seedPluginDistribution([['node-a', [row('board', {}, CHROME)]], ['node-b', []]])
      syncChromeContributions()
      expect(await refResolverRegistry.get('board-refs')!.resolve(['ENG-1'])).toEqual([])
      expect(writeJson).not.toHaveBeenCalled()
    })
  })

  it('takes all of a plugin’s chrome away when it stops being offered', () => {
    const shortcutChrome: Partial<PluginContributions> = {
      commands: [{ id: 'search', title: 'Board: search', category: 'action', palette: false, action: { verb: 'runNodeAction', path: '/v2/p/board/search' } }],
      keybindings: [{ command: 'search', defaultChord: 'meta+alt+b', when: 'global' }],
    }
    const overrideId = 'plugin.board.search'
    const overrides = { [overrideId]: 'meta+shift+b' }

    _seedPluginDistribution([['node-a', [row('board', {}, shortcutChrome)]]])
    syncChromeContributions()
    expect(orphanedPluginOverrideIds(overrides, keybindingRegistry.entries())).toEqual([])

    _seedPluginDistribution([['node-a', []]])
    syncChromeContributions()
    expect(ids()).toEqual({ sources: [], slots: [], shellSlots: [], contextMenus: [], commands: [], keybindings: [], attention: [], nodeStats: [], agentContexts: [], refResolvers: [] })
    expect(orphanedPluginOverrideIds(overrides, keybindingRegistry.entries())).toEqual([overrideId])
  })
})
