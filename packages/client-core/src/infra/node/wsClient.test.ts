import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryObserver } from '@tanstack/solid-query'
import { prefsKey, prefsRoute } from '@acorn/protocol/api.ts'
import { prefsOptions } from '../queries'
import { readJson } from './apiClient'
import { _resetFleet, clientFor, setCacheStorage } from './fleet'
import { watchWorkspaceChanges } from '../../features/workspaces/watchWorkspaceChanges'
import type { NodeStatus, NodeTransportError } from '@acorn/protocol/broker.ts'
import { activeToasts, dismissToast } from '../../features/notifications/toast'
import { setActiveNode } from './activeNode'
import { registerWsChannel } from './wsChannels'

// The renderer does not own a socket, so this fakes the broker rather than a WebSocket: the
// thing under test is the subscription bookkeeping and the reconnect behaviour, not a transport.

type Bridge = {
  sent: { nodeId: string; frame: unknown }[]
  emitFrame(frame: unknown, nodeId?: string): void
  // Terminal output, which is bytes rather than a frame (@acorn/protocol/ws.ts § The one binary
  // frame). The host has already peeled its own node id off; what arrives here still names the
  // session.
  emitBytes(frame: Uint8Array, nodeId?: string): void
  emitStatus(state: NodeStatus['state'], nodeId?: string): void
  emitError(error: NodeTransportError, nodeId?: string): void
  preferences: Record<string, Record<string, string>>
}

function installBridge(): Bridge {
  const preferences: Bridge['preferences'] = {}
  const sent: { nodeId: string; frame: unknown }[] = []
  const frameHandlers: ((nodeId: string, frame: unknown) => void)[] = []
  const byteHandlers: ((nodeId: string, frame: Uint8Array) => void)[] = []
  const statusHandlers: ((status: NodeStatus) => void)[] = []
  const errorHandlers: ((nodeId: string, error: NodeTransportError) => void)[] = []
  // `nodeFetch` is what makes the host's transport exist as far as platform/index.ts is concerned:
  // it is the "there is a broker" discriminator, so a fake that pushes frames has to answer
  // requests too, even if this suite never sends one.
  const acorn = {
    desktop: true,
    nodeFetch: async (nodeId: string, request: { path: string }) => {
      if (request.path !== prefsRoute) throw new Error(`Unexpected request: ${request.path}`)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(JSON.stringify(preferences[nodeId])),
      }
    },
    nodeSend: (nodeId: string, frame: unknown) => sent.push({ nodeId, frame }),
    onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => {
      frameHandlers.push(cb)
      return () => {}
    },
    onNodeBytes: (cb: (nodeId: string, frame: Uint8Array) => void) => {
      byteHandlers.push(cb)
      return () => {}
    },
    onNodeStatus: (cb: (status: NodeStatus) => void) => {
      statusHandlers.push(cb)
      return () => {}
    },
    onNodeTransportError: (cb: (nodeId: string, error: NodeTransportError) => void) => {
      errorHandlers.push(cb)
      return () => {}
    },
  }
  ;(globalThis as { window?: unknown }).window = { acorn }
  return {
    preferences,
    sent,
    // The nodeId defaults to the active node, so every existing case reads as before; the fleet cases
    // below pass a second node explicitly.
    emitFrame: (frame, nodeId = 'n1') => frameHandlers.forEach((cb) => cb(nodeId, frame)),
    emitBytes: (frame, nodeId = 'n1') => byteHandlers.forEach((cb) => cb(nodeId, frame)),
    emitStatus: (state, nodeId = 'n1') => statusHandlers.forEach((cb) => cb({ nodeId, state })),
    emitError: (error, nodeId = 'n1') => errorHandlers.forEach((cb) => cb(nodeId, error)),
  }
}

let bridge: Bridge
let client: typeof import('./wsClient')

beforeEach(async () => {
  bridge = installBridge()
  client = await import('./wsClient')
  client._resetWsClient()
  setActiveNode('n1')
})

afterEach(() => {
  for (const entry of activeToasts()) dismissToast(entry.id)
  client._resetWsClient()
  setActiveNode(null)
  delete (globalThis as { window?: unknown }).window
})

const framesSent = () => bridge.sent.map((s) => s.frame)

describe('wsClient', () => {
  it('refetches another client’s preferences on a grouping event and keeps other Nodes separate', async () => {
    setCacheStorage({ getItem: async () => undefined, setItem: async () => {}, removeItem: async () => {} })
    const first = clientFor('n1').client
    const second = clientFor('n2').client
    first.setQueryData(prefsKey, { 'core.workspaces': 'off' })
    second.setQueryData(prefsKey, { 'core.workspaces': 'off' })
    Object.assign(bridge.preferences, { n1: { 'core.workspaces': 'off' }, n2: { 'core.workspaces': 'on' } })
    const observer = new QueryObserver(second, {
      ...prefsOptions(true),
      queryFn: ({ signal }) => readJson<Record<string, string>>(prefsRoute, { nodeId: 'n2', signal }),
    })
    const unsubscribe = observer.subscribe(() => {})
    const off = watchWorkspaceChanges()
    const activeModes: string[] = []
    const offActive = client.wsOnNodeEvent('workspaces-mode:changed', ({ mode }) => activeModes.push(mode))
    try {
      // A separate client committed the write on n2. This client's fresh cache moves only on the event.
      expect(observer.getCurrentResult().data?.['core.workspaces']).toBe('off')
      bridge.emitFrame({ channel: 'workspaces-mode:changed', mode: 'on' }, 'n2')
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.['core.workspaces']).toBe('on'))
      expect(first.getQueryData(prefsKey)).toEqual({ 'core.workspaces': 'off' })
      expect(activeModes).toEqual([])
      bridge.emitFrame({ channel: 'workspaces-mode:changed', mode: 'on' }, 'n1')
      expect(activeModes).toEqual(['on'])
      expect(first.getQueryState(prefsKey)?.isInvalidated).toBe(true)
      off()
      first.setQueryData(prefsKey, { 'core.workspaces': 'off' })
      bridge.emitFrame({ channel: 'workspaces-mode:changed', mode: 'on' }, 'n1')
      expect(first.getQueryState(prefsKey)?.isInvalidated).toBe(false)
    } finally {
      off()
      offActive()
      unsubscribe()
      _resetFleet()
    }
  })
  it('shows a generic transport refusal to the user without changing sibling Node status', () => {
    client.wsConnect()
    bridge.emitError({ code: 'viewers_unsupported', message: 'Upgrade this Node for another window.' })
    expect(activeToasts()).toEqual([
      expect.objectContaining({ message: 'Upgrade this Node for another window.', tone: 'danger' }),
    ])
    bridge.emitStatus('online', 'n2')
    expect(activeToasts()).toHaveLength(1)
  })
  it('fans status, notice, step and agent frames to their subscribers', () => {
    const statuses: number[] = []
    const notices: string[] = []
    client.wsOnStatus(() => statuses.push(1))
    client.wsOnNotice((n) => notices.push(n.kind ?? ''))

    bridge.emitFrame({ channel: 'term:status' })
    bridge.emitFrame({
      channel: 'workflow:notice',
      notice: { taskId: 't1', kind: 'repo-config-trust', title: 'review', action: 'review-config' },
    })

    expect(statuses).toEqual([1])
    expect(notices).toEqual(['repo-config-trust'])
  })

  // `term:status` names the plugin whose chrome moved, or nothing when core itself pinged.
  it('hands a status subscriber the plugin id the frame named, and nothing when it named none', () => {
    const named: (string | undefined)[] = []
    client.wsOnStatus((pluginId) => named.push(pluginId))

    bridge.emitFrame({ channel: 'term:status', pluginId: 'board' })
    bridge.emitFrame({ channel: 'term:status' })
    bridge.emitFrame({ channel: 'term:status', pluginId: 7 })

    expect(named).toEqual(['board', undefined, undefined])
  })

  it('delivers fleet workspace changes with their owning Node while keeping ordinary subscriptions scoped', () => {
    const fleet: string[] = [],
      active: string[] = []
    const off = client.wsOnFleetWorkspaceChanged((nodeId, event) => fleet.push(`${nodeId}:${event.workspaceId}`))
    client.wsOnNodeEvent('workspace:changed', (event) => active.push(event.workspaceId))
    bridge.emitFrame({ channel: 'workspace:changed', workspaceId: 'shared' }, 'n2')
    bridge.emitFrame({ channel: 'workspace:changed', workspaceId: 'local' }, 'n1')
    expect(fleet).toEqual(['n2:shared', 'n1:local'])
    expect(active).toEqual(['local'])
    off()
    bridge.emitFrame({ channel: 'workspace:changed', workspaceId: 'after' }, 'n2')
    expect(fleet).toHaveLength(2)
  })

  it('routes core worktree invalidation', () => {
    const worktrees: (string | null)[] = []
    client.wsOnNodeEvent('worktree:status-changed', (event) => worktrees.push(event.taskId))

    bridge.emitFrame({ channel: 'worktree:status-changed', taskId: 't1' })

    expect(worktrees).toEqual(['t1'])
  })

  it('routes addressable task, workspace, mapping, and connection-deletion events', () => {
    const tasks: (string | null)[] = []
    const workspaces: string[] = []
    const mappings: { providerId: string; workspaceIds: string[] }[] = []
    const connections: unknown[] = []
    client.wsOnTasksChanged((event) => tasks.push(event.taskId))
    client.wsOnNodeEvent('workspace:changed', (event) => workspaces.push(event.workspaceId))
    client.wsOnNodeEvent('workspace-projects:changed', (event) => mappings.push(event))
    client.wsOnConnectionChanged((event) => connections.push(event))

    bridge.emitFrame({ channel: 'tasks:changed', taskId: 't1' })
    bridge.emitFrame({ channel: 'tasks:changed', taskId: null })
    bridge.emitFrame({ channel: 'tasks:changed' })
    bridge.emitFrame({ channel: 'workspace:changed', workspaceId: 'w1' })
    bridge.emitFrame({ channel: 'workspace-projects:changed', providerId: 'linear', workspaceIds: ['w1', 'w2'] })
    bridge.emitFrame({ channel: 'connection:changed', integrationId: 'c1', providerId: 'linear', deleted: true })

    expect(tasks).toEqual(['t1', null])
    expect(workspaces).toEqual(['w1'])
    expect(mappings).toEqual([{ providerId: 'linear', workspaceIds: ['w1', 'w2'] }])
    expect(connections).toEqual([{ integrationId: 'c1', providerId: 'linear', deleted: true }])
  })

  // The node's hub shed invalidation frames because this socket was too far behind to take them. The
  // remedy is the reconnect remedy, because nothing says which ones were dropped
  // (node-core/server/transport/wsHub.ts).
  it('treats a shed marker as a reason to refetch what is on screen', () => {
    const reconnects: number[] = []
    client.wsOnReconnect(() => reconnects.push(1))

    bridge.emitFrame({ channel: 'ws:shed' })

    expect(reconnects).toEqual([1])
  })

  it('ignores a frame that is not channel-tagged', () => {
    const statuses: number[] = []
    client.wsOnStatus(() => statuses.push(1))
    for (const bad of [null, undefined, 'string', 42, {}, { channel: 7 }]) bridge.emitFrame(bad)
    expect(statuses).toEqual([])
  })

  it('sends frames only to the active node', () => {
    client.wsSend({ channel: 'probe:input', id: 's1' })
    expect(bridge.sent.at(-1)).toEqual({ nodeId: 'n1', frame: { channel: 'probe:input', id: 's1' } })
    setActiveNode(null)
    client.wsSend({ channel: 'probe:input', id: 's1' })
    expect(bridge.sent).toHaveLength(1)
  })

  it('routes JSON and binary envelopes only from the active node', () => {
    const frames: unknown[] = []
    const bytes: Uint8Array[] = []
    const channel = registerWsChannel('probe', (frame) => frames.push(frame))
    const binary = client.registerWsBinaryHandler((frame) => bytes.push(frame))
    client.wsConnect()
    bridge.emitFrame({ channel: 'probe:thing' }, 'n2')
    bridge.emitFrame({ channel: 'probe:thing' })
    bridge.emitBytes(new Uint8Array([1]), 'n2')
    bridge.emitBytes(new Uint8Array([2]))
    expect(frames).toEqual([{ channel: 'probe:thing' }])
    expect(bytes).toEqual([new Uint8Array([2])])
    binary.dispose()
    channel.dispose()
  })

  it('delivers inactive-node plugin changes only to the fleet lifecycle subscriber', () => {
    const active: string[] = []
    const fleet: string[] = []
    client.wsOnPluginsChanged(() => active.push('changed'))
    client.wsOnFleetPluginsChanged((nodeId) => fleet.push(nodeId))
    bridge.emitFrame({ channel: 'plugins:changed' }, 'n2')
    expect(active).toEqual([])
    expect(fleet).toEqual(['n2'])
    bridge.emitFrame({ channel: 'plugins:changed' }, 'n1')
    expect(active).toEqual(['changed'])
    expect(fleet).toEqual(['n2', 'n1'])
  })

  it('replays each channel owner only on a genuine reconnect of the active node', () => {
    const reconnects: number[] = []
    const owner = registerWsChannel(
      'probe',
      () => {},
      () => [{ channel: 'probe:attach', id: 's1' }],
    )
    client.wsOnReconnect(() => reconnects.push(1))
    bridge.emitStatus('online')
    bridge.emitStatus('online', 'n2')
    expect(framesSent()).toEqual([])
    bridge.emitStatus('offline')
    bridge.emitStatus('online')
    expect(framesSent()).toEqual([{ channel: 'probe:attach', id: 's1' }])
    expect(reconnects).toEqual([1])
    owner.dispose()
  })
})
