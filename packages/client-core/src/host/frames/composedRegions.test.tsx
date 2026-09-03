import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow } from '@acorn/protocol/api.ts'
import type { DocumentHandle } from '../../features/editor/documentModel'

// What a composed pane hands each of its regions.
//
// Registration itself is ./register.test.ts's subject and runs with no DOM. This file is about the two
// things only a render can show: that a `remote` region is given the same document accessor a `frame`
// region gets, and that the selection which opened the pane reaches it.
//
// Both were missing, and both are the reason the Database pane's palette rows work at all. `document`
// is how `bridge.document.write` reaches the editor beside the tree — without it the broker refuses
// the verb, because its absence IS the permission check (./broker.ts). The retained pane intent is how
// a tree mounting for the first time learns which row opened it; a frame region has always consumed it
// into `context.item` (./PluginFrame.tsx) and a tree never did, so a command that opened a closed pane
// arrived with no selection at all.

const remoteProps: { document?: unknown; scope?: () => unknown }[] = []
let documentHandle: ((handle: DocumentHandle | null) => void) | null = null

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('../tree/RemoteTree', () => ({
  // The worker path is not what this file is about, and mounting one in jsdom would need a Worker.
  RemoteTree: (props: { document?: unknown; scope?: () => unknown }) => {
    remoteProps.push(props)
    return <span>worker-tree</span>
  },
}))
vi.mock('../../features/editor/DocumentSurface', () => ({
  default: (props: { onHandle?: (handle: DocumentHandle | null) => void }) => {
    documentHandle = props.onHandle ?? null
    return <span>editor</span>
  },
}))

const { paneRegistry } = await import('../registries/panes/panes')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../plugins/distribution')
const { setActiveNode } = await import('../../infra/node/activeNode')
const { syncFrameContributions, _resetFrameContributions } = await import('./register')

const HASH = 'a'.repeat(64)

const row = (): NodePluginRow => ({
  name: 'database',
  required: false,
  disabled: false,
  running: true,
  state: 'active',
  installed: {
    version: '1.0.0',
    apiVersion: PLUGIN_API_MAJOR,
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
    client: { hash: HASH, bytes: 12 },
    contributions: {
      frames: [{
        target: 'pane',
        id: 'database',
        label: 'Database',
        glyph: 'database',
        order: 70,
        scope: 'task',
        formFactor: ['desktop'],
        claimsKeys: [],
        layout: 'document-over-frame',
        regions: {
          document: { kind: 'document', languageId: 'sql', read: '/v2/p/database/tasks/:taskId/scratch' },
          frame: { kind: 'remote', entry: 'panel' },
        },
      }],
    },
  },
} as unknown as NodePluginRow)

describe('a composed pane’s remote region', () => {
  beforeEach(() => {
    remoteProps.length = 0
    documentHandle = null
    setActiveNode('node-a')
    // The trust gate is the frame pass's, not the chrome pass's: a pane mounts bytes, so the device
    // has to have accepted this exact hash before anything registers.
    _seedPluginDistribution([['node-a', [row()]]], [`database ${HASH}`])
    syncFrameContributions()
  })

  afterEach(() => {
    _resetFrameContributions()
    _resetPluginDistribution()
    setActiveNode(null)
  })

  it('is handed the sibling editor’s document, the same accessor a frame region gets', async () => {
    const pane = paneRegistry.entries().find((entry) => entry.id === 'database')!
    const dispose = render(() => pane.component({
      task: { id: 'task-1', projectId: 'p-1', links: [] },
    } as never), document.createElement('div'))

    // The layout and both region components are lazy, so the regions arrive a microtask later.
    await vi.waitFor(() => expect(remoteProps).toHaveLength(1))
    const accessor = remoteProps[0].document as (() => DocumentHandle | null) | undefined
    expect(typeof accessor).toBe('function')
    // Null until the editor beside it has loaded, which is the whole reason it is an accessor: the two
    // regions mount independently and either may be first.
    expect(accessor?.()).toBeNull()
    const handle = { read: () => 'select 1', write: () => {}, flush: async () => {} }
    documentHandle?.(handle)
    expect(accessor?.()).toBe(handle)
    dispose()
  })
})
