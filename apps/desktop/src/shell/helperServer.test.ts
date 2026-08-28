import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FleetNode } from '@acorn/desktop-helper/main/fleetStore.ts'
import type { Helper } from '@acorn/desktop-helper/main/index.ts'
import type { HelperMethod, HelperReply } from './wire'

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
vi.mock('@acorn/desktop-helper/main/nodePairing.ts', () => ({
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
