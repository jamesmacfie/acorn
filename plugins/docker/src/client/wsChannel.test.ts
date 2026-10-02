import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'

// Core's test covers the transport, the reconnect edge, and the fleet filter. This one covers
// docker's part: a stream routes by kind and id, and a live subscription re-attaches after a drop.
//
// The bridge is faked rather than a WebSocket, because the client owns no socket. The helper's
// broker does, so what is under test is subscription bookkeeping.

type Bridge = {
  sent: { nodeId: string; frame: unknown }[]
  emitFrame(frame: unknown, nodeId?: string): void
  emitStatus(state: NodeStatus['state'], nodeId?: string): void
}

function installBridge(): Bridge {
  const sent: { nodeId: string; frame: unknown }[] = []
  const frameHandlers: ((nodeId: string, frame: unknown) => void)[] = []
  const statusHandlers: ((status: NodeStatus) => void)[] = []
  const acorn = {
    desktop: true,
    // `nodeFetch` is the "there is a broker" discriminator in client-core's platform seam
    // (packages/client-core/src/infra/platform/index.ts), so a fake that pushes frames has to answer
    // requests too, even though this suite never sends one.
    nodeFetch: () => Promise.reject(new Error('this suite makes no requests')),
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
    emitFrame: (frame, nodeId = 'n1') => frameHandlers.forEach((cb) => cb(nodeId, frame)),
    emitStatus: (state, nodeId = 'n1') => statusHandlers.forEach((cb) => cb({ nodeId, state })),
  }
}

let bridge: Bridge
let channel: typeof import('./wsChannel')
let client: typeof import('@acorn/plugin-api/testkit/ws-client')

beforeEach(async () => {
  bridge = installBridge()
  client = await import('@acorn/plugin-api/testkit/ws-client')
  channel = await import('./wsChannel')
  client._resetWsClient()
  channel._resetDockerWsChannel()
  setActiveNode('n1')
})

afterEach(() => {
  client._resetWsClient()
  channel._resetDockerWsChannel()
  setActiveNode(null)
  delete (globalThis as { window?: unknown }).window
})

const framesSent = () => bridge.sent.map((s) => s.frame)

describe('docker ws channel', () => {
  it('routes log, stats and end frames by kind and id', () => {
    const events: unknown[] = []
    channel.wsDockerAttach('logs', 'c1', (e) => events.push(e))
    bridge.emitFrame({ channel: 'docker:log', id: 'c1', data: 'line' })
    bridge.emitFrame({ channel: 'docker:log', id: 'other', data: 'ignored' })
    bridge.emitFrame({ channel: 'docker:stream-end', id: 'c1', kind: 'logs' })
    expect(events).toEqual([{ kind: 'log', data: 'line' }, { kind: 'end' }])
  })

  // The reattach hook belongs to this plugin: core's reconnect loop asks each channel owner for its
  // frames rather than spelling `docker:${kind}:attach` itself.
  it('re-attaches a live stream after a genuine reconnect', () => {
    channel.wsDockerAttach('logs', 'c1', () => {})
    bridge.emitStatus('online') // first connect
    bridge.sent.length = 0

    bridge.emitStatus('offline')
    bridge.emitStatus('online')

    expect(framesSent()).toContainEqual({ channel: 'docker:logs:attach', id: 'c1' })
  })
  it('retires A before same-ID B attaches and keeps delayed A cleanup harmless', () => {
    const a: unknown[] = [], b: unknown[] = []
    const offA = channel.wsDockerAttach('logs', 'same', event => a.push(event))
    const execA = channel.wsDockerExecOpen('exec', 'same', 80, 24, event => a.push(event))
    setActiveNode('b')
    expect(bridge.sent.slice(-2)).toEqual([
      { nodeId: 'n1', frame: { channel: 'docker:logs:detach', id: 'same' } },
      { nodeId: 'n1', frame: { channel: 'docker:exec:kill', execId: 'exec' } },
    ])
    const offB = channel.wsDockerAttach('logs', 'same', event => b.push(event))
    const execB = channel.wsDockerExecOpen('exec', 'same', 80, 24, event => b.push(event))
    offA(); execA()
    bridge.emitFrame({ channel: 'docker:log', id: 'same', data: 'A late' }, 'n1')
    bridge.emitFrame({ channel: 'docker:log', id: 'same', data: 'B' }, 'b')
    bridge.emitFrame({ channel: 'docker:exec:out', execId: 'exec', data: 'B exec' }, 'b')
    expect(a).toEqual([{ kind: 'end' }, { kind: 'exit' }])
    expect(b).toEqual([{ kind: 'log', data: 'B' }, { kind: 'out', data: 'B exec' }])
    offB(); execB()
    expect(bridge.sent.at(-1)?.nodeId).toBe('b')
  })

  it('keeps the surviving same-Node viewer attached', () => {
    const first = channel.wsDockerAttach('logs', 'same', () => {})
    const events: unknown[] = []
    const second = channel.wsDockerAttach('logs', 'same', event => events.push(event))
    first()
    expect(framesSent().filter((frame: any) => frame.channel === 'docker:logs:detach')).toHaveLength(0)
    bridge.emitFrame({ channel: 'docker:log', id: 'same', data: 'still live' })
    expect(events).toEqual([{ kind: 'log', data: 'still live' }])
    second()
    expect(framesSent().filter((frame: any) => frame.channel === 'docker:logs:detach')).toHaveLength(1)
  })

})
