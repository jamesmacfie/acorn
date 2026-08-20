import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../queries'
import { PLUGIN_API_MAJOR, type NodePluginRow, type PluginContributions, type PluginDocumentRegion, type PluginFrameSurface } from '@acorn/protocol/api.ts'

const readJson = vi.fn()
const sendRaw = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }))
const writeJson = vi.fn()
vi.mock('../../apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: (...args: unknown[]) => writeJson(...args),
}))

const { setActiveNode } = await import('../../node/activeNode')
const { commandRegistry } = await import('../../registries/commands')
const { keybindingRegistry } = await import('../../registries/keybindings')
const { paneRegistry } = await import('../../registries/panes')
const { projectImporterRegistry } = await import('../../registries/projectImporters')
const { projectSurfaceRegistry } = await import('../../registries/projectSurfaces')
const { refPanelRegistry } = await import('../../registries/refPanels')
const { settingsRegistry } = await import('../../registries/settings')
const { uiSlotRegistry } = await import('../../registries/slots')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../distribution')
const { surfaceFailures } = await import('../surfaceFailures')
const { openPluginOverlay, closePluginOverlay } = await import('./overlays')
const { exclusiveSlotOffers, exclusiveSlotRegistry, resolveExclusiveSlot } = await import('../../registries/exclusiveSlots')
const { _resetFrameContributions, frameBindingFor, syncFrameContributions } = await import('./register')

// The frame host pass (docs/plugins.md § Frame contribution kind).
//
// The sibling of chrome/register.test.ts, and it exists because this module stopped being a `.tsx`
// file. What is pinned is the pass's contract rather than the rectangles: which registry each target
// lands in, the trust gate (stronger than chrome's), the routes it re-confines on arrival, per-node
// presence, and dispose-then-register.

const HASH = 'a'.repeat(64)

const surface = (over: Partial<PluginFrameSurface> & Pick<PluginFrameSurface, 'target' | 'id'>): PluginFrameSurface => ({
  label: over.id,
  glyph: 'puzzle',
  order: 500,
  formFactor: ['desktop'],
  ...over,
})

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
    client: { hash: HASH, bytes: 12 },
  },
  ...over,
})

// One accepted plugin on node-a. Everything below starts here, because a frame mounts bytes: an
// unaccepted bundle registers nothing at all, which is the first test rather than a precondition.
const seedTrusted = (...rows: NodePluginRow[]): void =>
  _seedPluginDistribution([['node-a', rows]], rows.map((entry) => `${entry.name} ${HASH}`))

const ids = () => ({
  panes: paneRegistry.entries().map((entry) => entry.id),
  projectSurfaces: projectSurfaceRegistry.entries().map((entry) => entry.id),
  refPanels: refPanelRegistry.entries().map((entry) => entry.id),
  settings: settingsRegistry.entries().map((entry) => entry.id),
  importers: projectImporterRegistry.entries().map((entry) => entry.id),
  slots: uiSlotRegistry.entries().map((entry) => entry.id),
})

const ALL_TARGETS: Partial<PluginContributions> = {
  frames: [
    surface({ target: 'pane', id: 'board-pane' }),
    surface({ target: 'webview', id: 'board-web', url: 'https://board.example/', hosts: ['board.example'] }),
    surface({ target: 'refPanel', id: 'board-ref' }),
    surface({ target: 'settings', id: 'board-settings' }),
    surface({ target: 'importer', id: 'board-importer' }),
    surface({ target: 'overlay', id: 'board-picker' }),
  ],
}

beforeEach(() => {
  setActiveNode('node-a')
})

afterEach(() => {
  _resetFrameContributions()
  _resetPluginDistribution()
  closePluginOverlay()
  setActiveNode(null)
})

describe('syncFrameContributions', () => {
  it('lands each target in its own registry', () => {
    seedTrusted(row('board', ALL_TARGETS))
    syncFrameContributions()
    expect(ids()).toEqual({
      // A webview is a pane: it occupies a slot in a task's layout like any other rectangle.
      panes: ['board-pane', 'board-web'],
      projectSurfaces: [],
      refPanels: ['board-ref'],
      settings: ['board-settings'],
      importers: ['board-importer'],
      slots: ['board-picker'],
    })
  })

  it('a coreSlot surface registers an OFFER, and replaces nothing until the owner picks it', () => {
    // The exclusive slot (registries/exclusiveSlots.ts owns the arbitration and its own test). What this
    // one pins is the wiring: the target lands in its own registry rather than in `panes`, so a
    // replacement never appears in the pane switcher, and registering it changes nothing on screen.
    seedTrusted(row('board', {
      frames: [surface({ target: 'coreSlot', id: 'board-rail', coreSlot: 'rail.taskList' })],
    }))
    syncFrameContributions()
    expect(ids().panes).toEqual([])
    expect(exclusiveSlotOffers('rail.taskList').map((entry) => entry.pluginId)).toEqual(['board'])
    expect(resolveExclusiveSlot('rail.taskList', undefined)).toBeNull()
    expect(resolveExclusiveSlot('rail.taskList', 'board')?.pluginId).toBe('board')
  })

  it('refuses a coreSlot surface naming a core surface this shell has no host for', () => {
    // Version skew: a newer node describing a designated surface this client cannot draw. Refused rather
    // than coerced into the one that does exist, so the failure is visible to its author.
    seedTrusted(row('board', {
      frames: [surface({ target: 'coreSlot', id: 'board-rail', coreSlot: 'sidebar.future' })],
    }))
    syncFrameContributions()
    expect(exclusiveSlotRegistry.entries()).toEqual([])
    expect(surfaceFailures().map((entry) => entry.surface)).toContain('board-rail')
  })

  it('registers nothing at all until this device has accepted the exact bytes', () => {
    // The gate that makes "never auto-run code a Node pushed" hold at the registration boundary rather
    // than at the iframe. Stronger than the chrome pass's, which only asks whether code was withheld.
    _seedPluginDistribution([['node-a', [row('board', ALL_TARGETS)]]])
    syncFrameContributions()
    expect(ids().panes).toEqual([])

    seedTrusted(row('board', ALL_TARGETS))
    syncFrameContributions()
    expect(ids().panes).toEqual(['board-pane', 'board-web'])
  })

  it('does nothing before the distribution pass has resolved a bundle', () => {
    // `activeBundles()` null means no bundle has won per plugin id yet, so there is nothing to mount.
    _resetPluginDistribution()
    syncFrameContributions()
    expect(ids().panes).toEqual([])
  })

  it('registers a host-drawn document pane for a plugin whose bytes were never accepted', () => {
    // The one surface acceptance does not withhold: the host draws the editor and the plugin's
    // contribution is two routes on a node, so no bytes execute and there is nothing for a bytes-hash
    // prompt to be about. A plugin that ships only document surfaces needs no client bundle at all.
    const doc = surface({
      target: 'pane',
      id: 'board-doc',
      layout: { template: 'document', document: { read: '/v2/p/board/doc', languageId: 'markdown' } },
    })
    _seedPluginDistribution([['node-a', [row('board', { frames: [doc, surface({ target: 'pane', id: 'board-pane' })] })]]])
    syncFrameContributions()
    expect(ids().panes).toEqual(['board-doc'])
  })

  it('withholds a composed document pane from an unaccepted bundle', () => {
    // `document-over-frame` puts half the rectangle in the plugin's own iframe, so it is a frame and
    // needs an accepted hash exactly like any other. A composed pane is not a cheaper way to run
    // untrusted code.
    const composed = surface({
      target: 'pane',
      id: 'board-doc',
      layout: { template: 'document-over-frame', document: { read: '/v2/p/board/doc', languageId: 'markdown' } },
    })
    _seedPluginDistribution([['node-a', [row('board', { frames: [composed] })]]])
    syncFrameContributions()
    expect(ids().panes).toEqual([])

    seedTrusted(row('board', { frames: [composed] }))
    syncFrameContributions()
    expect(ids().panes).toEqual(['board-doc'])
  })

  it('skips a surface a desktop shell would have to render unusably', () => {
    seedTrusted(row('board', {
      frames: [surface({ target: 'pane', id: 'phone-only', formFactor: ['mobile'] }), surface({ target: 'pane', id: 'board-pane' })],
    }))
    syncFrameContributions()
    expect(ids().panes).toEqual(['board-pane'])
  })

  it('gates every surface it can on the plugin running on the node being looked at', () => {
    seedTrusted(row('board', ALL_TARGETS))
    _seedPluginDistribution([['node-a', [row('board', ALL_TARGETS)]], ['node-b', []]], [`board ${HASH}`])
    syncFrameContributions()
    // Each registry hands its gate something different (a task, nothing, the shell's render context),
    // and a plugin surface reads none of it, which is the point: presence on the node is the whole
    // question, so the same predicate is correct in all three places.
    const task = { id: 'task-1' } as Task
    const slotContext = {
      taskActive: false,
      terminalOpen: false,
      toggleTerminal: () => {},
      closeTerminal: () => {},
      openSettings: () => {},
      selectTask: () => {},
      activeTask: null,
    }
    const gates = () => [
      paneRegistry.get('board-pane')!.when!(task),
      refPanelRegistry.get('board-ref')!.when!(),
      uiSlotRegistry.get('board-picker')!.when!(slotContext),
    ]
    expect(gates()).toEqual([true, true, true])
    setActiveNode('node-b')
    expect(gates()).toEqual([false, false, false])
  })

  it('replaces rather than duplicates on a second pass', () => {
    seedTrusted(row('board', ALL_TARGETS))
    syncFrameContributions()
    // The registries throw on a duplicate id, so a pass that failed to dispose would not merely double
    // the list. It would take the plugin's surfaces away entirely.
    syncFrameContributions()
    expect(ids().panes).toEqual(['board-pane', 'board-web'])
    expect(ids().slots).toEqual(['board-picker'])
  })

  it('takes every surface away when the plugin stops being offered', () => {
    seedTrusted(row('board', ALL_TARGETS))
    syncFrameContributions()
    _seedPluginDistribution([['node-a', []]])
    syncFrameContributions()
    expect(ids()).toEqual({ panes: [], projectSurfaces: [], refPanels: [], settings: [], importers: [], slots: [] })
    expect(commandRegistry.entries().filter((entry) => entry.id.startsWith('plugin.'))).toEqual([])
  })

  it('keeps one bad surface from costing the plugin its others, and says why', () => {
    const clash = paneRegistry.register({ id: 'board-pane', label: 'Core board', glyph: 'x', order: 1, component: () => null })
    seedTrusted(row('board', ALL_TARGETS))
    syncFrameContributions()
    expect(paneRegistry.get('board-pane')!.label).toBe('Core board')
    // Everything else the manifest declared is still there, and the reason the missing one is missing
    // reaches the attention inbox rather than only a console nobody has open.
    expect(ids().settings).toEqual(['board-settings'])
    expect(surfaceFailures().map((failure) => failure.surface)).toEqual(['board-pane'])
    clash.dispose()
  })

  it('clears recorded failures on the pass that replaces them', () => {
    const clash = paneRegistry.register({ id: 'board-pane', label: 'Core board', glyph: 'x', order: 1, component: () => null })
    seedTrusted(row('board', ALL_TARGETS))
    syncFrameContributions()
    expect(surfaceFailures()).toHaveLength(1)
    clash.dispose()
    syncFrameContributions()
    expect(surfaceFailures()).toEqual([])
  })

  describe('reference panels', () => {
    it('stamps the provider from the plugin id', () => {
      seedTrusted(row('board', { frames: [surface({ target: 'refPanel', id: 'board-ref' })] }))
      syncFrameContributions()
      expect(refPanelRegistry.get('board-ref')!.providerId).toBe('board')
    })

    it('refuses a panel that claims another plugin’s items', () => {
      // How a plugin would get its own rows rendered as somebody else's, the same line the content-link
      // stamp holds one registry over.
      seedTrusted(row('board', { frames: [surface({ target: 'refPanel', id: 'board-ref', providerId: 'linear' })] }))
      syncFrameContributions()
      expect(ids().refPanels).toEqual([])
      expect(surfaceFailures()[0]?.reason).toMatch(/declared provider 'linear' is not 'board'/)
    })
  })

  describe('project-scoped panes', () => {
    const projectPane = surface({ target: 'pane', id: 'board-issue', scope: 'project' })
    const route = (over: Record<string, unknown> = {}) => ({
      id: 'board-issue-route',
      path: '/p/:projectId/x/board/issues/:issue',
      surface: 'board-issue',
      item: 'issue',
      order: 500,
      ...over,
    })

    it('registers the declared route beside the surface', () => {
      seedTrusted(row('board', { frames: [projectPane], routes: [route()] }))
      syncFrameContributions()
      expect(projectSurfaceRegistry.get('board-issue')).toMatchObject({
        path: '/p/:projectId/x/board/issues/:issue',
        item: 'issue',
      })
      // And never as a task pane: it has no layout key to persist and no task to hand it.
      expect(ids().panes).toEqual([])
    })

    it('re-confines the route on arrival', () => {
      // The node confined these when it parsed the manifest, but the manifest reached this device as a
      // roster row, which is bytes a node sent.
      const refused = [
        { frames: [projectPane] },
        { frames: [projectPane], routes: [route({ path: '/p/:projectId/x/linear/issues/:issue' })] },
        { frames: [projectPane], routes: [route({ path: '/p/:projectId/x/board/issues' })] },
      ]
      for (const declared of refused) {
        seedTrusted(row('board', declared))
        syncFrameContributions()
        expect(ids().projectSurfaces).toEqual([])
      }
    })
  })

  describe('document panes', () => {
    const docPane = (region: Omit<PluginDocumentRegion, 'languageId'>) => surface({
      target: 'pane',
      id: 'board-doc',
      layout: { template: 'document', document: { languageId: 'markdown', ...region } },
    })

    it('refuses a document route outside the plugin’s own namespace', () => {
      for (const region of [
        { read: '/v2/core/tasks' },
        { read: '/v2/p/board/doc', write: '/v2/core/tasks' },
        { read: '/v2/p/board/doc', completions: { route: '/v2/core/tasks' } },
      ]) {
        _seedPluginDistribution([['node-a', [row('board', { frames: [docPane(region)] })]]])
        syncFrameContributions()
        expect(ids().panes).toEqual([])
      }
    })
  })

  describe('overlays', () => {
    beforeEach(() => {
      seedTrusted(row('board', { frames: [surface({ target: 'overlay', id: 'board-picker', label: 'Pick a card' })] }))
      syncFrameContributions()
    })

    const closeId = 'plugin.board.overlay-close.board-picker'

    it('contributes the slot, its close command and Escape as one unit', () => {
      expect(ids().slots).toEqual(['board-picker'])
      expect(commandRegistry.get(closeId)).toMatchObject({ title: 'Close Pick a card', palette: false })
      expect(keybindingRegistry.get(closeId)).toMatchObject({ defaultChord: 'escape', when: 'typing-exempt', category: 'board' })
    })

    it('offers the close command only while its own overlay is up', () => {
      const command = commandRegistry.get(closeId)!
      const binding = keybindingRegistry.get(closeId)!
      expect(command.when!()).toBe(false)
      openPluginOverlay('board', 'board-picker')
      expect(command.when!()).toBe(true)
      expect(binding.active!()).toBe(true)
      // Another plugin's picker is not this one's, so this Escape must not claim it.
      openPluginOverlay('linear', 'board-picker')
      expect(command.when!()).toBe(false)
    })

    it('closes the overlay when its command runs', () => {
      openPluginOverlay('board', 'board-picker')
      commandRegistry.get(closeId)!.run!()
      expect(commandRegistry.get(closeId)!.when!()).toBe(false)
    })
  })
})

describe('frameBindingFor', () => {
  const declared: Partial<PluginContributions> = {
    frames: [
      surface({ target: 'pane', id: 'board-pane' }),
      surface({ target: 'webview', id: 'board-web', url: 'https://board.example/', hosts: ['board.example'] }),
      surface({ target: 'pane', id: 'board-issue', scope: 'project' }),
      surface({ target: 'overlay', id: 'board-picker' }),
      surface({ target: 'refPanel', id: 'board-ref' }),
    ],
  }

  it('allows openPane to name this plugin’s task panes and nothing else', () => {
    // The allowlist for the one verb that drives the shell's layout from inside a sandbox. A webview is
    // a task pane; a project-scoped pane and an overlay are not, and an `openPane` naming either would
    // be an offer that can only fail.
    const board = row('board', declared)
    const binding = frameBindingFor('board', declared.frames![0]!, board)
    expect(binding.panes).toEqual(['board-pane', 'board-web'])
  })

  it('re-applies the closed key-claim policy to a roster row', () => {
    // The node parsed these already. The device checks again, because a roster row is wire input, and
    // a plugin that could claim Escape or ⌘K would take the shell's own way out.
    const claimed = surface({ target: 'pane', id: 'board-pane', claimsKeys: ['meta+shift+b', 'escape', 'meta+k', 'b'] })
    const board = row('board', { frames: [claimed] })
    expect(frameBindingFor('board', claimed, board).claimsKeys).toEqual(['meta+shift+b'])
  })

  it('carries the declared hosts for a webview and for nothing else', () => {
    const board = row('board', declared)
    expect(frameBindingFor('board', declared.frames![1]!, board).hosts).toEqual(['board.example'])
    expect(frameBindingFor('board', declared.frames![0]!, board).hosts).toBeUndefined()
  })

  it('pins the node the host is talking to, never one the frame could name', () => {
    setActiveNode('node-a')
    const board = row('board', declared)
    expect(frameBindingFor('board', declared.frames![0]!, board).nodeId).toBe('node-a')
    setActiveNode(null)
    // The browser-served `dev:node` mode, where the origin is the node.
    expect(frameBindingFor('board', declared.frames![0]!, board).nodeId).toBe('')
  })
})
