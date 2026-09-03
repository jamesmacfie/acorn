import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FleetNode } from '@acorn/custody/broker/fleetStore.ts'
import type { Helper } from '@acorn/custody/index.ts'
import type { HelperMessage, HelperMethod, HelperReply } from '../shell/wire'

// The fleet's second door, end to end through the socket the renderer actually speaks.
//
// Every piece `node-adopt` composes is tested where it lives: the broker, the pairing probe, the
// fleet store, and the node-side adopt route. What is only true when they are put together is the
// security property — a provider vouches for a fingerprint, and the certificate the endpoint
// presents has to be that one. So this drives the real handler over the real WebSocket, with the
// probe stubbed to be the endpoint's answer, and asserts both halves: a mismatch pairs nothing, and
// a match pairs without the device token ever reaching the renderer.

const VOUCHED = 'a'.repeat(64)
const SUBSTITUTED = 'b'.repeat(64)

const probeNode = vi.fn()
vi.mock('@acorn/custody/broker/nodePairing.ts', () => ({
  probeNode: (endpoint: string) => probeNode(endpoint),
  pairWithNode: () => {
    throw new Error('not used')
  },
}))

const { startHelperServer } = await import('./helperServer')

const ADOPT_RESULT = {
  nodeId: 'node-1',
  label: 'provisioned-1',
  endpoint: 'https://10.0.0.7:4318',
  fingerprint: VOUCHED,
  deviceToken: 'device-token-nobody-else-sees',
}

type Stub = {
  helper: Helper
  remembered: { node: FleetNode; token: string }[]
  upserted: unknown[]
}

const stubHelper = (): Stub => {
  const remembered: { node: FleetNode; token: string }[] = []
  const upserted: unknown[] = []
  const helper = {
    broker: {
      fetch: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(JSON.stringify(ADOPT_RESULT)),
      }),
      upsert: (record: unknown) => void upserted.push(record),
      statuses: () => [],
    },
    fleet: {
      list: () => remembered.map((entry) => entry.node),
      get: (nodeId: string) => remembered.find((entry) => entry.node.nodeId === nodeId)?.node,
      tokenFor: (nodeId: string) => remembered.find((entry) => entry.node.nodeId === nodeId)?.token,
      remember: (node: FleetNode, token: string) => {
        remembered.push({ node, token })
        return node
      },
    },
  } as unknown as Helper
  return { helper, remembered, upserted }
}

const servers: { close(): Promise<void> }[] = []

const call = async (helper: Helper, method: HelperMethod, params: unknown): Promise<HelperReply> => {
  const server = await startHelperServer(helper, { secret: 's'.repeat(32), appOrigin: 'http://acorn.localhost' })
  servers.push(server)
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/helper?secret=${server.secret}`)
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const reply = new Promise<HelperReply>((resolve) => socket.once('message', (data) => resolve(JSON.parse(String(data)) as HelperReply)))
    socket.send(JSON.stringify({ id: 1, method, params }))
    return await reply
  } finally {
    socket.close()
  }
}

afterEach(async () => {
  probeNode.mockReset()
  for (const server of servers.splice(0)) await server.close()
})

const REQUEST = { sourceNodeId: 'local', providerId: 'cloud:nodes', providerNodeId: 'inst-42', label: 'Big box' }

describe('node-adopt checks the vouched fingerprint against the certificate', () => {
  it('refuses a node presenting an identity the provider did not vouch for', async () => {
    probeNode.mockResolvedValue({ endpoint: ADOPT_RESULT.endpoint, fingerprint: SUBSTITUTED, protocolVersion: 1, compatible: true, certPem: 'cert' })
    const { helper, remembered, upserted } = stubHelper()

    const reply = await call(helper, 'node-adopt', REQUEST)

    expect(reply.ok).toBe(false)
    expect(reply.ok === false && reply.error).toContain('cloud:nodes')
    // Nothing was remembered and no connection was opened: a substituted endpoint must not become a
    // pinned row that later reconnects on its own.
    expect(remembered).toEqual([])
    expect(upserted).toEqual([])
  })

  it('pairs a matching node and keeps the device token out of the reply', async () => {
    probeNode.mockResolvedValue({ endpoint: ADOPT_RESULT.endpoint, fingerprint: VOUCHED, protocolVersion: 1, compatible: true, certPem: 'cert-pem' })
    const { helper, remembered, upserted } = stubHelper()

    const reply = await call(helper, 'node-adopt', REQUEST)

    expect(reply.ok).toBe(true)
    expect(reply.ok === true && reply.value).toEqual({
      nodeId: 'node-1',
      label: 'Big box',
      endpoint: ADOPT_RESULT.endpoint,
      fingerprint: VOUCHED,
      local: false,
      provider: { providerId: 'cloud:nodes', providerNodeId: 'inst-42', sourceNodeId: 'local' },
    })
    expect(JSON.stringify(reply)).not.toContain(ADOPT_RESULT.deviceToken)
    expect(remembered).toHaveLength(1)
    expect(remembered[0]?.token).toBe(ADOPT_RESULT.deviceToken)
    expect(remembered[0]?.node.certPem).toBe('cert-pem')
    expect(upserted).toHaveLength(1)
  })
})


// The helper forwards the active node's frames and nobody else's.
//
// The broker opens a socket to every paired node and pushes every frame across this boundary, and the
// renderer drops whatever is not the active node on arrival
// (@acorn/client-core/infra/node/wsClient.ts). So an N-node fleet paid two process boundaries, a
// stringify and a parse per frame to deliver frames that were then thrown away
// (docs/performance.md). Nobody has to tell the helper which node is active:
// every request the renderer makes names one.
describe('the helper forwards only the active node', () => {
  const connect = async () => {
    const { helper } = stubHelper()
    const server = await startHelperServer(helper, { secret: 's'.repeat(32), appOrigin: 'http://acorn.localhost' })
    servers.push(server)
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/helper?secret=${server.secret}`)
    const received: HelperMessage[] = []
    socket.on('message', (data) => received.push(JSON.parse(String(data)) as HelperMessage))
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    // One round trip through the socket, waiting for this probe's own reply, so every message sent
    // before it has been handled and every push sent before it has arrived.
    let probe = 1000
    const settled = async () => {
      const id = probe++
      await new Promise<void>((resolve) => {
        const listener = (data: unknown) => {
          const message = JSON.parse(String(data)) as { id?: number }
          if (message.id !== id) return
          socket.off('message', listener)
          resolve()
        }
        socket.on('message', listener)
        socket.send(JSON.stringify({ id, method: 'fleet-list', params: {} }))
      })
      return received.filter((m) => 'push' in m)
    }
    return { socket, settled, server }
  }

  it('drops a frame from a node the renderer is not addressing, and keeps every node\'s status', async () => {
    const { socket, settled, server } = await connect()
    try {
      // Addressing node-a is what makes it the active one. `node-send` and `node-fetch` both count.
      socket.send(JSON.stringify({ id: 1, method: 'node-send', params: { nodeId: 'node-a', frame: { channel: 'term:attach', id: 's1' } } }))
      await settled()

      server.push({ push: 'node-frame', nodeId: 'node-a', frame: { channel: 'tasks:changed' } })
      server.push({ push: 'node-frame', nodeId: 'node-b', frame: { channel: 'tasks:changed' } })
      server.push({ push: 'node-status', status: { nodeId: 'node-b', state: 'online' } })

      expect(await settled()).toEqual([
        { push: 'node-frame', nodeId: 'node-a', frame: { channel: 'tasks:changed' } },
        { push: 'node-status', status: { nodeId: 'node-b', state: 'online' } },
      ])
    } finally {
      socket.close()
    }
  })

  it('forwards every node until the renderer has named one', async () => {
    const { socket, settled, server } = await connect()
    try {
      server.push({ push: 'node-frame', nodeId: 'node-b', frame: { channel: 'tasks:changed' } })
      expect(await settled()).toEqual([{ push: 'node-frame', nodeId: 'node-b', frame: { channel: 'tasks:changed' } }])
    } finally {
      socket.close()
    }
  })

  // A node switch changes the fact with the renderer's first request to the new node.
  it('follows the renderer to a new node', async () => {
    const { socket, settled, server } = await connect()
    try {
      socket.send(JSON.stringify({ id: 1, method: 'node-send', params: { nodeId: 'node-a', frame: { channel: 'term:attach', id: 's1' } } }))
      await settled()
      socket.send(JSON.stringify({ id: 2, method: 'node-send', params: { nodeId: 'node-b', frame: { channel: 'term:attach', id: 's2' } } }))
      await settled()

      server.push({ push: 'node-frame', nodeId: 'node-a', frame: { channel: 'tasks:changed' } })
      server.push({ push: 'node-frame', nodeId: 'node-b', frame: { channel: 'tasks:changed' } })

      expect(await settled()).toEqual([{ push: 'node-frame', nodeId: 'node-b', frame: { channel: 'tasks:changed' } }])
    } finally {
      socket.close()
    }
  })
})
