import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { setActiveNode } from '@acorn/client-core/node/activeNode.ts'

// Moved here from @acorn/client-core/wsClient.test.ts with the channel it covers. Core's test
// keeps the transport, the reconnect edge and the fleet filter. This one keeps what is docker's:
// that a stream is routed by kind and id, and that a live subscription re-attaches after a drop.
//
// The bridge is faked, not a WebSocket: the renderer does not own a socket, Electron main's
// broker does, so the thing under test is subscription bookkeeping.

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
    // (packages/client-core/src/platform/index.ts), so a fake that pushes frames has to answer
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
let client: typeof import('@acorn/client-core/wsClient.ts')

beforeEach(async () => {
  bridge = installBridge()
  client = await import('@acorn/client-core/wsClient.ts')
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

  // The reattach hook is this plugin's now: core's reconnect loop asks each channel owner for its
  // frames rather than knowing how to spell `docker:${kind}:attach` itself.
  it('re-attaches a live stream after a genuine reconnect', () => {
    channel.wsDockerAttach('logs', 'c1', () => {})
    bridge.emitStatus('online') // first connect
    bridge.sent.length = 0

    bridge.emitStatus('offline')
    bridge.emitStatus('online')

    expect(framesSent()).toContainEqual({ channel: 'docker:logs:attach', id: 'c1' })
  })
})
