import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { setActiveNode } from './node/activeNode'

// The renderer no longer owns a socket, so this fakes the BROKER rather than a WebSocket: the thing
// under test is the subscription bookkeeping and the reconnect behaviour, not a transport.

type Bridge = {
  sent: { nodeId: string; frame: unknown }[]
  emitFrame(frame: unknown): void
  emitStatus(state: NodeStatus['state']): void
}

function installBridge(): Bridge {
  const sent: { nodeId: string; frame: unknown }[] = []
  const frameHandlers: ((nodeId: string, frame: unknown) => void)[] = []
  const statusHandlers: ((status: NodeStatus) => void)[] = []
  const acorn = {
    desktop: true,
    nodeSend: (nodeId: string, frame: unknown) => sent.push({ nodeId, frame }),
    onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => {
      frameHandlers.push(cb)
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
    emitFrame: (frame) => frameHandlers.forEach((cb) => cb('n1', frame)),
    emitStatus: (state) => statusHandlers.forEach((cb) => cb({ nodeId: 'n1', state })),
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
    const agents: unknown[] = []
    client.wsOnStatus(() => statuses.push(1))
    client.wsOnNotice((n) => notices.push(n.kind))
    client.wsOnAgentFrame((f) => agents.push(f))

    bridge.emitFrame({ channel: 'term:status' })
    bridge.emitFrame({ channel: 'workflow:notice', notice: { taskId: 't1', kind: 'repo-config-trust', title: 'review', action: 'review-config' } })
    bridge.emitFrame({ channel: 'agent:deleted', sessionId: 'a1' })

    expect(statuses).toEqual([1])
    expect(notices).toEqual(['repo-config-trust'])
    expect(agents).toEqual([{ channel: 'agent:deleted', sessionId: 'a1' }])
  })

  it('ignores a frame that is not channel-tagged', () => {
    const statuses: number[] = []
    client.wsOnStatus(() => statuses.push(1))
    for (const bad of [null, undefined, 'string', 42, {}, { channel: 7 }]) bridge.emitFrame(bad)
    expect(statuses).toEqual([])
  })

  // The FIRST online transition is a connect, not a reconnect: re-attaching there would duplicate the
  // attach the subscriber already sent, and refetching would fire on every cold start.
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
    client.wsDockerAttach('logs', 'c1', () => {})
    bridge.emitStatus('online') // first connect
    bridge.sent.length = 0

    bridge.emitStatus('offline')
    bridge.emitStatus('online')

    expect(framesSent()).toContainEqual({ channel: 'term:attach', id: 's1' })
    expect(framesSent()).toContainEqual({ channel: 'docker:logs:attach', id: 'c1' })
    expect(reconnects).toEqual([1])
  })

  it('does not re-attach on a non-online transition', () => {
    client.wsAttach('s1', () => {})
    bridge.emitStatus('online')
    bridge.sent.length = 0
    for (const state of ['degraded', 'offline', 'revoked', 'incompatible'] as const) bridge.emitStatus(state)
    expect(bridge.sent).toHaveLength(0)
  })

  it('routes docker log, stats and end frames by kind and id', () => {
    const events: unknown[] = []
    client.wsDockerAttach('logs', 'c1', (e) => events.push(e))
    bridge.emitFrame({ channel: 'docker:log', id: 'c1', data: 'line' })
    bridge.emitFrame({ channel: 'docker:log', id: 'other', data: 'ignored' })
    bridge.emitFrame({ channel: 'docker:stream-end', id: 'c1', kind: 'logs' })
    expect(events).toEqual([{ kind: 'log', data: 'line' }, { kind: 'end' }])
  })
})
