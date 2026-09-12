import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { setActiveNode } from './activeNode'
import { encodeIdFrame } from '@acorn/protocol/ws.ts'
import { registerWsChannel } from './wsChannels'

// The renderer no longer owns a socket, so this fakes the broker rather than a WebSocket: the
// thing under test is the subscription bookkeeping and the reconnect behaviour, not a transport.

type Bridge = {
  sent: { nodeId: string; frame: unknown }[]
  emitFrame(frame: unknown, nodeId?: string): void
  // Terminal output, which is bytes rather than a frame (@acorn/protocol/ws.ts § The one binary
  // frame). The host has already peeled its own node id off; what arrives here still names the
  // session.
  emitBytes(frame: Uint8Array, nodeId?: string): void
  emitStatus(state: NodeStatus['state'], nodeId?: string): void
}

function installBridge(): Bridge {
  const sent: { nodeId: string; frame: unknown }[] = []
  const frameHandlers: ((nodeId: string, frame: unknown) => void)[] = []
  const byteHandlers: ((nodeId: string, frame: Uint8Array) => void)[] = []
  const statusHandlers: ((status: NodeStatus) => void)[] = []
  // `nodeFetch` is what makes the host's transport exist as far as platform/index.ts is concerned:
  // it is the "there is a broker" discriminator, so a fake that pushes frames has to answer
  // requests too, even if this suite never sends one.
  const acorn = {
    desktop: true,
    nodeFetch: () => Promise.reject(new Error('this suite makes no requests')),
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
  }
  ;(globalThis as { window?: unknown }).window = { acorn }
  return {
    sent,
    // The nodeId defaults to the active node, so every existing case reads as before; the fleet cases
    // below pass a second node explicitly.
    emitFrame: (frame, nodeId = 'n1') => frameHandlers.forEach((cb) => cb(nodeId, frame)),
    emitBytes: (frame, nodeId = 'n1') => byteHandlers.forEach((cb) => cb(nodeId, frame)),
    emitStatus: (state, nodeId = 'n1') => statusHandlers.forEach((cb) => cb({ nodeId, state })),
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
  client._resetWsClient()
  setActiveNode(null)
  delete (globalThis as { window?: unknown }).window
})

const framesSent = () => bridge.sent.map((s) => s.frame)

describe('wsClient', () => {
  it('attaches on the first local subscriber and dispatches output to it', () => {
    const output: unknown[] = []
    const off = client.wsAttach('s1', (m) => output.push(m))
    expect(framesSent()).toContainEqual({ channel: 'term:attach', id: 's1' })

    bridge.emitFrame({ channel: 'term:out', id: 's1', msg: { type: 'output', data: 'ring' } })
    expect(output).toEqual([{ type: 'output', data: 'ring' }])
    off()
  })

  // Phase 6 of the performance programme: output arrives as bytes and reaches the same subscriber
  // (docs/performance.md § 2026-09-03 — phase 6).
  it('routes a binary frame to the session it names, decoded', () => {
    const session = '11111111-2222-3333-4444-555555555555'
    const output: unknown[] = []
    const off = client.wsAttach(session, (m) => output.push(m))

    bridge.emitBytes(encodeIdFrame(session, new TextEncoder().encode('ünïcøde 🌰\r\n'))!)
    // …and one for a session nothing is subscribed to, which is dropped rather than thrown.
    bridge.emitBytes(encodeIdFrame('99999999-8888-7777-6666-555555555555', new TextEncoder().encode('elsewhere'))!)
    // …and a frame too short to hold an id at all.
    bridge.emitBytes(new Uint8Array([1, 2, 3]))

    expect(output).toEqual([{ type: 'output', data: 'ünïcøde 🌰\r\n' }])
    off()
  })

  it('drops a binary frame from a node this client is not looking at', () => {
    const session = '11111111-2222-3333-4444-555555555555'
    const output: unknown[] = []
    const off = client.wsAttach(session, (m) => output.push(m))

    bridge.emitBytes(encodeIdFrame(session, new TextEncoder().encode('from n2'))!, 'n2')

    expect(output).toEqual([])
    off()
  })

  // The contract the node depends on: one attach per session per connection, one detach at the end.
  it('attaches once for many subscribers and detaches on the last unsubscribe', () => {
    const offA = client.wsAttach('s1', () => {})
    const offB = client.wsAttach('s1', () => {})
    expect(framesSent().filter((f) => (f as { channel: string }).channel === 'term:attach')).toHaveLength(1)

    offA()
    expect(framesSent()).not.toContainEqual({ channel: 'term:detach', id: 's1' })
    offB()
    expect(framesSent()).toContainEqual({ channel: 'term:detach', id: 's1' })
  })

  it('sends every frame to the active node', () => {
    client.wsWrite('s1', 'echo ok\n')
    expect(bridge.sent.at(-1)).toEqual({ nodeId: 'n1', frame: { channel: 'term:input', id: 's1', data: 'echo ok\n' } })
  })

  it('drops frames when no node is active rather than throwing', () => {
    setActiveNode(null)
    expect(() => client.wsWrite('s1', 'x')).not.toThrow()
    expect(bridge.sent).toHaveLength(0)
  })

  it('fans status, notice, step and agent frames to their subscribers', () => {
    const statuses: number[] = []
    const notices: string[] = []
    client.wsOnStatus(() => statuses.push(1))
    client.wsOnNotice((n) => notices.push(n.kind ?? ''))

    bridge.emitFrame({ channel: 'term:status' })
    bridge.emitFrame({ channel: 'workflow:notice', notice: { taskId: 't1', kind: 'repo-config-trust', title: 'review', action: 'review-config' } })

    expect(statuses).toEqual([1])
    expect(notices).toEqual(['repo-config-trust'])
  })

  // Phase 5 split the old content-free `term:status` ping in two and gave what is left of it a plugin
  // id (docs/performance.md § 2026-09-03 — phase 5).
  it('hands a status subscriber the plugin id the frame named, and nothing when it named none', () => {
    const named: (string | undefined)[] = []
    client.wsOnStatus((pluginId) => named.push(pluginId))

    bridge.emitFrame({ channel: 'term:status', pluginId: 'board' })
    bridge.emitFrame({ channel: 'term:status' })
    bridge.emitFrame({ channel: 'term:status', pluginId: 7 })

    expect(named).toEqual(['board', undefined, undefined])
  })

  it('routes the two events the status ping was split into', () => {
    const sessions: number[] = []
    const worktrees: (string | null)[] = []
    client.wsOnNodeEvent('terminal:sessions-changed', () => sessions.push(1))
    client.wsOnNodeEvent('worktree:status-changed', (event) => worktrees.push(event.taskId))

    bridge.emitFrame({ channel: 'terminal:sessions-changed' })
    bridge.emitFrame({ channel: 'worktree:status-changed', taskId: 't1' })

    expect(sessions).toEqual([1])
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

  // The first online transition is a connect, not a reconnect: re-attaching there would duplicate
  // the attach the subscriber already sent, and refetching would fire on every cold start.
  it('does not treat the first online transition as a reconnect', () => {
    const reconnects: number[] = []
    client.wsOnReconnect(() => reconnects.push(1))
    client.wsAttach('s1', () => {})
    const before = framesSent().length

    bridge.emitStatus('online')
    expect(reconnects).toEqual([])
    expect(framesSent()).toHaveLength(before)
  })

  it('re-attaches live subscriptions and announces a refetch on a genuine reconnect', () => {
    const reconnects: number[] = []
    client.wsOnReconnect(() => reconnects.push(1))
    client.wsAttach('s1', () => {})
    bridge.emitStatus('online') // first connect
    bridge.sent.length = 0

    bridge.emitStatus('offline')
    bridge.emitStatus('online')

    expect(framesSent()).toContainEqual({ channel: 'term:attach', id: 's1' })
    expect(reconnects).toEqual([1])
  })

  it('does not re-attach on a non-online transition', () => {
    client.wsAttach('s1', () => {})
    bridge.emitStatus('online')
    bridge.sent.length = 0
    for (const state of ['degraded', 'offline', 'revoked', 'incompatible'] as const) bridge.emitStatus(state)
    expect(bridge.sent).toHaveLength(0)
  })


  // Main holds a socket to every paired node and pushes every frame here, while the subscription
  // maps below are keyed on session/container/exec ids alone. Two nodes may coincidentally hold
  // the same UUID (docs/architecture-overview.md § Client state and fleet behavior), and that must
  // never collide in the client.
  describe('frames from a node that is not the active one', () => {
    it('does not reach a terminal subscriber, even for the same session id', () => {
      const output: unknown[] = []
      client.wsAttach('s1', (m) => output.push(m))
      bridge.emitFrame({ channel: 'term:out', id: 's1', msg: { type: 'output', data: 'from-b' } }, 'n2')
      expect(output).toEqual([])
      // …and the identical frame from the active node does, so the filter is the reason and not the shape.
      bridge.emitFrame({ channel: 'term:out', id: 's1', msg: { type: 'output', data: 'from-a' } })
      expect(output).toEqual([{ type: 'output', data: 'from-a' }])
    })

    // Asserted through a channel this test registers rather than a real plugin's: the filter is core's,
    // and naming a plugin here would make a core test depend on a feature that may not be installed.
    it('does not reach a registered channel owner', () => {
      const frames: unknown[] = []
      const registration = registerWsChannel('probe', (frame) => frames.push(frame))
      // Registering a channel does not open the socket; the subscribe helpers do. Say so explicitly.
      client.wsConnect()
      try {
        bridge.emitFrame({ channel: 'probe:thing', id: 'a1' }, 'n2')
        expect(frames).toEqual([])
        bridge.emitFrame({ channel: 'probe:thing', id: 'a1' })
        expect(frames).toEqual([{ channel: 'probe:thing', id: 'a1' }])
      } finally {
        registration.dispose()
      }
    })

    it('follows the active node when it changes', () => {
      const output: unknown[] = []
      client.wsAttach('s1', (m) => output.push(m))
      setActiveNode('n2')
      bridge.emitFrame({ channel: 'term:out', id: 's1', msg: { type: 'output', data: 'now-b' } }, 'n2')
      expect(output).toEqual([{ type: 'output', data: 'now-b' }])
    })
  })

  describe('reconnect bookkeeping is per node', () => {
    it('treats a second node\'s FIRST connect as a first connect, not a reconnect', () => {
      // A single `everOnline` boolean was set by whichever node connected first, so node B's very first
      // online status re-attached every one of node A's PTY subscriptions and told the shell to refetch.
      const reconnects: number[] = []
      client.wsOnReconnect(() => reconnects.push(1))
      client.wsAttach('s1', () => {})
      bridge.emitStatus('online') // n1's first connect
      bridge.sent.length = 0
      bridge.emitStatus('online', 'n2') // n2's first connect
      expect(reconnects).toEqual([])
      expect(bridge.sent).toHaveLength(0)
    })

    it('ignores a reconnect of a node that is not active', () => {
      const reconnects: number[] = []
      client.wsOnReconnect(() => reconnects.push(1))
      client.wsAttach('s1', () => {})
      bridge.emitStatus('online', 'n2')
      bridge.emitStatus('offline', 'n2')
      bridge.sent.length = 0
      bridge.emitStatus('online', 'n2') // n2's genuine reconnect — nothing to do with n1's queries
      expect(reconnects).toEqual([])
      expect(bridge.sent).toHaveLength(0)
      // The active node's own reconnect still works, so the guard is not simply switched off.
      bridge.emitStatus('online')
      bridge.emitStatus('online')
      expect(reconnects).toEqual([1])
      expect(framesSent()).toContainEqual({ channel: 'term:attach', id: 's1' })
    })
  })
})
