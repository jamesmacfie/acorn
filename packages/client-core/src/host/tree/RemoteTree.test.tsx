import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'

// What a tree is told when it connects.
//
// One question, and it is the one a `frame` region has always answered and a tree never did: which row
// opened this pane. A selection made while the pane is already mounted arrives as a `select` message,
// which the component's own effect and event listener already handled. A selection that OPENED the
// pane cannot, because the event fires before the pane exists — so `openPane` retains the intent and
// the region consumes it at connect into `context.item` (../frames/PluginFrame.tsx does the same).
//
// Without it a palette search whose `onSelect` opens a pane worked only when the pane was already
// open, which is the half of the time nobody would report as a bug.

const connects: ((port: MessagePort) => unknown)[] = []
const contexts: PluginFrameContext[] = []
let port: MessagePort | null = null

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('./TreeHost', () => ({ TreeHost: () => <span>tree</span> }))
vi.mock('../frames/frameServices', () => ({ createFrameServices: () => ({}) }))
vi.mock('../frames/broker', () => ({
  createFrameBridge: (args: { context: PluginFrameContext }) => {
    contexts.push(args.context)
    return {}
  },
  postSelect: vi.fn(),
  postSurfaceAction: vi.fn(),
}))
vi.mock('./workerHost', () => ({
  acquireTreeWorker: (options: { connect: (port: MessagePort) => unknown }) => {
    connects.push(options.connect)
    return {
      transport: () => ({}),
      mount: () => {},
      unmount: () => {},
      release: () => {},
      bridgePort: () => port,
    }
  },
}))

const { RemoteTree } = await import('./RemoteTree')
const { openPane, consumePaneIntent } = await import('../registries/commands/clientEvents')
const { _resetPluginDistribution } = await import('../plugins/distribution')
const { setActiveNode } = await import('../../infra/node/activeNode')

const contribution = { id: 'database', pluginId: 'database', hash: 'a'.repeat(64), entry: 'panel' }

const mount = (scope: { taskId?: string; projectId?: string; item?: string }) => {
  const dispose = render(
    () => <RemoteTree contribution={contribution} props={() => scope} scope={() => scope} />,
    document.createElement('div'),
  )
  // The worker is acquired during setup; connecting is the host's job and the fake above captured it.
  connects.at(-1)?.(null as unknown as MessagePort)
  return dispose
}

describe('a remote tree’s connect context', () => {
  beforeEach(() => {
    connects.length = 0
    contexts.length = 0
    port = null
    setActiveNode('node-a')
  })
  afterEach(() => {
    _resetPluginDistribution()
    setActiveNode(null)
    consumePaneIntent('task-1', 'database')
  })

  it('carries the row that opened the pane, retained until this tree consumed it', () => {
    // The palette picked a row and the pane was not open. `openPane` dispatches the layout change and
    // retains the intent; the tree below is what the layout change eventually mounts.
    openPane('task-1', 'database', { kind: 'plugin:select', item: 'query-7' })
    const dispose = mount({ taskId: 'task-1', projectId: 'p-1' })
    expect(contexts.at(-1)).toMatchObject({ surface: 'database', taskId: 'task-1', item: 'query-7' })
    // Consumed, so a later remount is not handed a stale selection.
    expect(consumePaneIntent('task-1', 'database')).toBeUndefined()
    dispose()
  })

  it('prefers the routed item, which is a project surface’s current selection rather than a one-shot', () => {
    openPane('task-1', 'database', { kind: 'plugin:select', item: 'query-7' })
    const dispose = mount({ taskId: 'task-1', item: 'routed-3' })
    expect(contexts.at(-1)).toMatchObject({ item: 'routed-3' })
    dispose()
  })

  it('carries no item when nothing opened it, rather than an empty one', () => {
    const dispose = mount({ taskId: 'task-1' })
    expect(contexts.at(-1)).not.toHaveProperty('item')
    dispose()
  })

  it('ignores an intent retained for another pane of the same task', () => {
    openPane('task-1', 'http', { kind: 'plugin:select', item: 'request-9' })
    const dispose = mount({ taskId: 'task-1' })
    expect(contexts.at(-1)).not.toHaveProperty('item')
    consumePaneIntent('task-1', 'http')
    dispose()
  })
})
