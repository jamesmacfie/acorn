import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { Server } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { duplexPair } from 'node:stream'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { relayHost } from '@acorn/protocol/relay.ts'
import { mintInternalToken } from '@acorn/node-core/server/auth'
import { openDataRoot, type DataRoot } from '@acorn/node-core/server/storage'
import { closeListener, makeRuntime, startListener, type Listener } from '@acorn/node-core/server/transport/listener.ts'
import { NodeBroker, type BrokerNode } from './nodeBroker'

// The two assumptions the relay rests on (docs/relay.md), proven with no relay at all: an in-memory
// pair of streams stands in for one. The broker's agent gets one end, and the other enters a real
// Node's HTTPS server the way a relayed stream does, by `emit('connection')`.

type RunningNode = { nodeId: string; root: DataRoot; listener: Listener; dir: string; close(): void; token: string }

const environment = { ...process.env }
const nodes: RunningNode[] = []
const brokers: NodeBroker[] = []
let a: RunningNode
let b: RunningNode

async function startNode(): Promise<RunningNode> {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-relay-transport-'))
  const root = openDataRoot(dir)
  const runtime = makeRuntime(root)
  const listener = await startListener(runtime, root)
  const { token } = await runtime.DEVICES.issue('relay transport test')
  const node = { nodeId: root.nodeId, root, listener, dir, close: () => runtime.DB.close(), token }
  nodes.push(node)
  return node
}

beforeAll(async () => {
  delete process.env.ACORN_PORT
  process.env.SESSION_ENC_KEY = '0'.repeat(64)
  // Relay settings are what make a Node accept the relay Host name. Nothing listens at this URL.
  process.env.ACORN_RELAY_URL = 'ws://127.0.0.1:9'
  process.env.ACORN_RELAY_CREDENTIAL = 'relay-credential'
  a = await startNode()
  b = await startNode()
}, 60_000)

afterEach(() => {
  for (const broker of brokers.splice(0)) broker.dispose()
})

afterAll(async () => {
  for (const node of nodes) {
    await closeListener(node.listener.server)
    node.close()
    node.root.release()
    rmSync(node.dir, { recursive: true, force: true })
  }
  process.env = environment
})

// Each call is one relayed connection, delivered to `node` whatever route the broker asked for.
const relayTo = (node: RunningNode) => async () => {
  const [client, server] = duplexPair()
  ;(node.listener.server as unknown as Server).emit('connection', server)
  return client
}

// A relayed fleet record for `node`, pinned to `pin`'s certificate.
const relayed = (node: RunningNode, pin: RunningNode = node): BrokerNode => ({
  nodeId: node.nodeId,
  label: 'relayed',
  local: false,
  endpoint: `https://${relayHost(node.nodeId)}`,
  relay: { url: 'ws://relay.invalid', route: node.nodeId },
  relayCredential: 'relay-credential',
  fingerprint: pin.listener.fingerprint,
  certPem: pin.listener.certPem,
  token: node.token,
})

function brokerThrough(node: RunningNode): { broker: NodeBroker; statuses: NodeStatus[] } {
  const statuses: NodeStatus[] = []
  const broker = new NodeBroker(
    { frame: () => {}, bytes: () => {}, status: (status) => statuses.push(status) },
    { openRelayStream: relayTo(node) },
  )
  brokers.push(broker)
  return { broker, statuses }
}

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const json = (body: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(body))

describe('a relayed connection', () => {
  it('carries pinned requests and the event socket to the Node', async () => {
    const { broker, statuses } = brokerThrough(a)
    broker.upsert(relayed(a))
    // `online` means the event WebSocket upgraded on a socket the server got by emit.
    await waitFor(() => statuses.at(-1)?.state === 'online', 'the event socket')
    const response = await broker.fetch(a.nodeId, { requestId: 'info', path: '/v1/node' })
    expect(response.status).toBe(200)
    // The node ID appears only for an authenticated caller, so the device token got in too.
    expect(json(response.body)).toMatchObject({ nodeId: a.nodeId, fingerprint: a.listener.fingerprint })
  })

  it('refuses a Node whose certificate is not the pinned one', async () => {
    const { broker, statuses } = brokerThrough(b)
    broker.upsert(relayed(a))
    await waitFor(() => statuses.some((status) => status.error?.code === 'identity_mismatch'), 'the pin to bite')
    await expect(broker.fetch(a.nodeId, { requestId: 'info', path: '/v1/node' })).rejects.toThrow(/self-signed/)
  })

  it('is never a loopback caller', async () => {
    const { broker, statuses } = brokerThrough(a)
    broker.upsert(relayed(a))
    await waitFor(() => statuses.at(-1)?.state === 'online', 'the event socket')
    const body = { kind: 'bytes' as const, bytes: new TextEncoder().encode('{}') }
    const headers = { 'content-type': 'application/json' }
    for (const [method, path, code] of [
      ['POST', '/v1/pair/requests', 'pairing_local_only'],
      ['PUT', '/v1/core/node/reach', 'reach_local_only'],
      ['POST', '/v1/core/node/stop', 'stop_local_only'],
    ] as const) {
      const response = await broker.fetch(a.nodeId, { requestId: path, method, path, headers, body })
      expect([path, response.status, json(response.body)]).toMatchObject([path, 403, { error: { code } }])
    }
    // An internal token counts only from loopback, so through the relay it is no credential at all.
    const internal = mintInternalToken(readFileSync(join(a.dir, 'internal-token'), 'utf8').trim(), { scope: 'service' })
    const { broker: anonymous } = brokerThrough(a)
    anonymous.upsert({ ...relayed(a), token: 'not-a-device-token' })
    const response = await anonymous.fetch(a.nodeId, {
      requestId: 'internal',
      path: '/v1/core/tasks',
      headers: { 'x-acorn-internal': internal },
    })
    expect(response.status).toBe(401)
  })
})
