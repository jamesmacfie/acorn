import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { createConnection, createServer, type Server as TcpServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ChannelFailure, runChannelClient, type ChannelClient } from '@acorn/channel/client.ts'
import { IdentityMismatchError, openChannel } from '@acorn/channel/secure.ts'
import type { RuntimeBindings } from '@acorn/node-core/server/bindings.ts'
import { openDataRoot, type DataRoot } from '@acorn/node-core/server/storage'
import { channelPublicKey } from '@acorn/node-core/server/transport/channelKey.ts'
import { closeListener, makeRuntime, startListener, type Listener } from '@acorn/node-core/server/transport/listener.ts'
import { relayCredentialProtocols, relayUrls } from '@acorn/protocol/relay.ts'
import { startRelay, type Relay } from './relay'

// A phone's channel to a real Node through a real relay (docs/relay/phone-channel.md): the handshake,
// the routes a phone's device is held off, the event feed, and what the relay can see.

const CREDENTIAL = 'phone-channel-relay-credential'
const environment = { ...process.env }
const cleanup: (() => unknown)[] = []
let relay: Relay
let proxy: { port: number; recorded: Buffer[] }
let node: { root: DataRoot; runtime: RuntimeBindings; listener: Listener }
let nodeKey: string

// A TCP proxy in front of the relay that keeps every byte crossing it, both ways.
async function recordingProxy(target: number): Promise<{ port: number; recorded: Buffer[] }> {
  const recorded: Buffer[] = []
  const sockets = new Set<Socket>()
  const server: TcpServer = createServer((inbound) => {
    const outbound = createConnection(target, '127.0.0.1')
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

const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 20_000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

type Phone = { client: ChannelClient; frames: unknown[]; bytes: Uint8Array[] }

// What a phone's browser does: open a browser stream with its credential as a subprotocol, run the
// handshake against the key it pinned, and speak the messages.
async function phone(pinned = nodeKey): Promise<Phone> {
  const url = relayUrls.connect(`ws://127.0.0.1:${proxy.port}`, node.root.nodeId, 'browser')
  const socket = new WebSocket(url, relayCredentialProtocols(CREDENTIAL))
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  const channel = await openChannel(socket, pinned)
  const frames: unknown[] = []
  const bytes: Uint8Array[] = []
  const client = runChannelClient(channel, {
    onFrame: (json) => frames.push(JSON.parse(json)),
    onBytes: (frame) => bytes.push(frame),
  })
  cleanup.push(() => client.close())
  return { client, frames, bytes }
}

// Waits for the Node to be on the relay, then connects, because it dials out once its listener binds.
async function connectPhone(pinned = nodeKey): Promise<Phone> {
  let connected: Phone | undefined
  await waitFor(async () => Boolean((connected = await phone(pinned).catch(() => undefined))), 'the phone to connect')
  return connected!
}

// A client on this computer asks to pair, which the Node announces to every connected feed.
const askFromThisComputer = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const port = node.listener.endpoint.port
    const ask = httpsRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/pair/requests',
        method: 'POST',
        ca: node.listener.certPem,
        headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' },
      },
      (response) => (response.resume(), response.once('end', resolve)),
    )
    ask.once('error', reject)
    ask.end(JSON.stringify({ deviceName: 'Laptop asking' }))
  })

const get = (client: ChannelClient, path: string, token: string, method = 'GET') =>
  client.request({ method, path, headers: { authorization: `Bearer ${token}` } })
const json = (body: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(body))

beforeAll(async () => {
  relay = await startRelay({ auth: CREDENTIAL })
  proxy = await recordingProxy(relay.port)
  delete process.env.ACORN_PORT
  process.env.SESSION_ENC_KEY = '0'.repeat(64)
  process.env.ACORN_RELAY_URL = `ws://127.0.0.1:${proxy.port}`
  process.env.ACORN_RELAY_CREDENTIAL = CREDENTIAL
  const dir = mkdtempSync(join(tmpdir(), 'acorn-phone-channel-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const root = openDataRoot(dir)
  const runtime = makeRuntime(root)
  const listener = await startListener(runtime, root)
  cleanup.push(async () => {
    await closeListener(listener.server)
    runtime.DB.close()
    root.release()
  })
  node = { root, runtime, listener }
  nodeKey = channelPublicKey(root.dir)
})

afterAll(async () => {
  for (const step of cleanup.reverse()) await step()
  await relay.close()
  process.env = environment
})

describe('a phone’s channel through a relay', () => {
  it('reads the Node’s routes with a device token, and the relay sees only ciphertext', async () => {
    const device = await node.runtime.DEVICES.issue('Laptop')
    const { client } = await connectPhone()
    const answer = await get(client, '/v1/core/projects', device.token)
    expect(answer.status).toBe(200)
    expect(json(answer.body)).toHaveProperty('projects')
    // Without the token it's an ordinary 401 from the Node's own router.
    expect((await get(client, '/v1/core/projects', 'acorn_dt_nope')).status).toBe(401)

    const seen = Buffer.concat(proxy.recorded)
    expect(seen.length).toBeGreaterThan(0)
    for (const plaintext of [device.token, '/v1/core/projects', 'acorn_dt_', 'HTTP/1.1 200', 'projects'])
      expect(seen.includes(Buffer.from(plaintext)), plaintext).toBe(false)
  })

  it('refuses a Node whose key is not the one the phone pinned', async () => {
    await connectPhone()
    await expect(phone('ab'.repeat(32))).rejects.toBeInstanceOf(IdentityMismatchError)
  })

  it('never makes a channel a loopback caller', async () => {
    const device = await node.runtime.DEVICES.issue('Laptop')
    const { client } = await connectPhone()
    for (const [method, path, code] of [
      ['POST', '/v1/pair/requests', 'pairing_local_only'],
      ['PUT', '/v1/core/node/reach', 'reach_local_only'],
      ['POST', '/v1/core/node/stop', 'stop_local_only'],
    ] as const) {
      const answer = await client.request({
        method,
        path,
        headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
        body: new TextEncoder().encode('{}'),
      })
      expect([path, answer.status, json(answer.body)]).toMatchObject([path, 403, { error: { code } }])
    }
  })

  it('pairs a phone with a code and holds its device to the routes it has a screen for', async () => {
    const { client } = await connectPhone()
    const code = node.runtime.PAIRING_CODES.issue()!
    const paired = await client.request({
      method: 'POST',
      path: '/v1/pair',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({ code, deviceName: 'Test phone' })),
    })
    expect(paired.status).toBe(200)
    const { deviceToken, device } = json(paired.body) as { deviceToken: string; device: { id: string } }
    expect((await node.runtime.DEVICES.list()).find((row) => row.id === device.id)?.kind).toBe('phone')

    expect((await get(client, '/v1/core/projects', deviceToken)).status).toBe(200)
    for (const [method, path] of [
      ['POST', '/v1/core/pair/start'],
      ['GET', '/v1/core/devices'],
      ['POST', '/v1/core/plugins/github/reload'],
      ['PUT', '/v1/core/plugins/github/development'],
      ['GET', '/v1/core/backup'],
      ['PUT', '/v1/core/security/secret-publication'],
      ['POST', '/v1/core/node/stop'],
    ]) {
      const answer = await get(client, path!, deviceToken, method)
      expect([method, path, answer.status, json(answer.body)]).toMatchObject([
        method,
        path,
        403,
        { error: { code: 'phone_refused' } },
      ])
    }
    // Answering a pairing request is what it may do. Nothing is pending, so the Node says so.
    expect((await get(client, '/v1/core/pair/requests', deviceToken)).status).toBe(200)

    // The same routes are open to a device that did not pair from a phone.
    const laptop = await node.runtime.DEVICES.issue('Laptop')
    expect((await get(client, '/v1/core/devices', laptop.token)).status).toBe(200)
  })

  it('carries the event feed, and closes it when the device is revoked', async () => {
    const device = await node.runtime.DEVICES.issue('Phone', 'phone')
    const { client, frames } = await connectPhone()
    expect(await client.openEvents('acorn_dt_nope')).toBe(false)

    expect(await client.openEvents(device.token)).toBe(true)
    await askFromThisComputer()
    await waitFor(() => frames.length > 0, 'a frame')
    expect(frames[0]).toMatchObject({ channel: 'pairing:requested', seq: 1 })

    await node.runtime.DEVICES.revoke(device.device.id)
    await client.closed
    await expect(get(client, '/v1/node', device.token)).rejects.toBeInstanceOf(ChannelFailure)
  })
})
