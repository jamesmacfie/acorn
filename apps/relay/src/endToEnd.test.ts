import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer, type Server as TcpServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { NodeBroker, pairedNode, toBrokerNode, type FleetNode } from '@acorn/custody/broker'
import { pairWithNode, probeNode } from '@acorn/custody/broker/nodePairing.ts'
import type { RuntimeBindings } from '@acorn/node-core/server/bindings.ts'
import { openDataRoot, type DataRoot } from '@acorn/node-core/server/storage'
import { closeListener, makeRuntime, startListener, type Listener } from '@acorn/node-core/server/transport/listener.ts'
import { startRelay, type Relay } from './relay'

// One Node behind a real relay, reached by the real broker, the way docs/relay.md describes it. The
// Node dials the relay through a recording proxy, which is where the ciphertext check reads.

const CREDENTIAL = 'end-to-end-relay-credential'
const environment = { ...process.env }
const cleanup: (() => unknown)[] = []
let relay: Relay
let relayPort: number
let proxy: { port: number; recorded: Buffer[] }
let node: { root: DataRoot; runtime: RuntimeBindings; listener: Listener }
let paired: FleetNode
let token: string

// A TCP proxy in front of the relay that keeps every byte crossing it, both ways.
async function recordingProxy(target: () => number): Promise<{ port: number; recorded: Buffer[] }> {
  const recorded: Buffer[] = []
  const sockets = new Set<Socket>()
  const server: TcpServer = createServer((inbound) => {
    const outbound = createConnection(target(), '127.0.0.1')
    for (const socket of [inbound, outbound]) {
      sockets.add(socket)
      socket.on('data', (chunk: Buffer) => recorded.push(chunk))
      socket.on('error', () => {})
      socket.on('close', () => {
        sockets.delete(socket)
        inbound.destroy()
        outbound.destroy()
      })
    }
    inbound.pipe(outbound).pipe(inbound)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => {
    for (const socket of sockets) socket.destroy()
    server.close()
  })
  return { port: (server.address() as { port: number }).port, recorded }
}

async function startNode(dir: string) {
  const root = openDataRoot(dir)
  const runtime = makeRuntime(root)
  const listener = await startListener(runtime, root)
  cleanup.push(async () => {
    await closeListener(listener.server)
    runtime.DB.close()
    root.release()
  })
  return { root, runtime, listener }
}

const freshDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-relay-e2e-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 20_000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function broker(): { broker: NodeBroker; statuses: NodeStatus[] } {
  const statuses: NodeStatus[] = []
  const created = new NodeBroker({ frame: () => {}, bytes: () => {}, status: (status) => statuses.push(status) })
  cleanup.push(() => created.dispose())
  return { broker: created, statuses }
}

const address = (): string => `ws://${CREDENTIAL}@127.0.0.1:${relayPort}/${node.root.nodeId}`
const json = (body: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(body))

beforeAll(async () => {
  relay = await startRelay({ auth: CREDENTIAL })
  relayPort = relay.port
  proxy = await recordingProxy(() => relayPort)
  delete process.env.ACORN_PORT
  process.env.SESSION_ENC_KEY = '0'.repeat(64)
  process.env.ACORN_RELAY_URL = `ws://127.0.0.1:${proxy.port}`
  process.env.ACORN_RELAY_CREDENTIAL = CREDENTIAL
  node = await startNode(freshDir())
})

afterAll(async () => {
  for (const step of cleanup.reverse()) await step()
  await relay.close()
  process.env = environment
})

describe('a Node behind a relay', () => {
  it('pairs with a code, and the identity the client sees is the Node’s own', async () => {
    let probe: Awaited<ReturnType<typeof probeNode>> | undefined
    // The Node dials out once its listener binds, so the route appears a moment later.
    await waitFor(async () => Boolean((probe = await probeNode(address()).catch(() => undefined))), 'the route')
    expect(probe).toMatchObject({
      endpoint: `https://${node.root.nodeId}.relay.acorn`,
      fingerprint: node.listener.fingerprint,
      relay: { url: `ws://127.0.0.1:${relayPort}`, route: node.root.nodeId },
      compatible: true,
    })
    const result = await pairWithNode(probe!, { code: node.runtime.PAIRING_CODES.issue()!, deviceName: 'e2e' })
    expect(result.nodeId).toBe(node.root.nodeId)
    paired = pairedNode(probe!, result, { label: 'relayed', local: false })
    token = result.deviceToken
    expect(paired.relayCredential).toBe(CREDENTIAL)
  })

  it('carries requests and the event socket, and the relay sees only ciphertext', async () => {
    const { broker: connected, statuses } = broker()
    connected.upsert(toBrokerNode(paired, token))
    await waitFor(() => statuses.at(-1)?.state === 'online', 'the event socket')
    const response = await connected.fetch(paired.nodeId, { requestId: 'tasks', path: '/v1/core/tasks' })
    expect(response.status).toBe(200)
    const seen = Buffer.concat(proxy.recorded)
    expect(seen.length).toBeGreaterThan(0)
    for (const plaintext of [token, '/v1/core/tasks', 'acorn_dt_', 'HTTP/1.1 200'])
      expect(seen.includes(Buffer.from(plaintext)), plaintext).toBe(false)
  })

  it('never makes a relayed caller a loopback one', async () => {
    const { broker: connected } = broker()
    connected.upsert(toBrokerNode(paired, token))
    const body = { kind: 'bytes' as const, bytes: new TextEncoder().encode('{}') }
    const headers = { 'content-type': 'application/json' }
    for (const [method, path, code] of [
      ['POST', '/v1/pair/requests', 'pairing_local_only'],
      ['PUT', '/v1/core/node/reach', 'reach_local_only'],
      ['POST', '/v1/core/node/stop', 'stop_local_only'],
    ] as const) {
      const response = await connected.fetch(paired.nodeId, { requestId: path, method, path, headers, body })
      expect([path, response.status, json(response.body)]).toMatchObject([path, 403, { error: { code } }])
    }
  })

  it('reconnects the Node and the client after the relay restarts', async () => {
    const { broker: connected, statuses } = broker()
    connected.upsert(toBrokerNode(paired, token))
    await waitFor(() => statuses.at(-1)?.state === 'online', 'the event socket')
    await relay.close()
    await waitFor(() => statuses.at(-1)?.state !== 'online', 'the client to notice')
    relay = await startRelay({ auth: CREDENTIAL, port: relayPort })
    await waitFor(() => statuses.at(-1)?.state === 'online', 'the client to come back')
    const response = await connected.fetch(paired.nodeId, { requestId: 'after', path: '/v1/node' })
    expect(json(response.body)).toMatchObject({ nodeId: paired.nodeId })
  })

  it('refuses a different Node that takes the same route', async () => {
    // An impostor whose node.json claims the paired Node's ID, so it registers the same route.
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'node.json'),
      JSON.stringify({ baseline: ACORN_BASELINE, nodeId: paired.nodeId, createdAt: Date.now() }),
    )
    await startNode(dir)
    const { broker: connected, statuses } = broker()
    // The relay hands the route to the newest connection, so this stream reaches the impostor.
    await waitFor(
      async () => (await probeNode(paired).catch(() => null))?.fingerprint !== paired.fingerprint,
      'the swap',
    )
    connected.upsert(toBrokerNode(paired, token))
    await waitFor(() => statuses.some((status) => status.error?.code === 'identity_mismatch'), 'the pin to bite')
  })
})
