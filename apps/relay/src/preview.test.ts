import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect as tlsConnect, TLSSocket, type ConnectionOptions } from 'node:tls'
import { createConnection } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWebSocketStream, WebSocket } from 'ws'
import { previewNodeLabel, relayControlMessageSchema, relayUrls } from '@acorn/protocol/relay.ts'
import { ensureCert } from '@acorn/node-core/server/transport/tls.ts'
import { startRelay, type Relay } from './relay'

// Previews through the relay (PROTOCOL.md § Preview streams): a browser's TLS connection on a name under
// the preview domain reaches the Node that name belongs to, and the relay reads only the ClientHello.

const CREDENTIAL = 'preview-test-credential'
const ROUTE = '2f1d6a7e-3c7c-4a52-9a55-7c1d2f4d8a10'
const DOMAIN = 'preview.test'
const cleanup: (() => unknown)[] = []
let relay: Relay
let label: string
let dir: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'relay-preview-'))
  label = await previewNodeLabel(ROUTE)
  relay = await startRelay({ auth: CREDENTIAL, acceptTimeoutMs: 300, preview: { domain: DOMAIN, port: 0 } })
})

afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo()
  await relay.close()
  rmSync(dir, { recursive: true, force: true })
})

type Offer = { id: string; kind: string }
const headers = { authorization: `Bearer ${CREDENTIAL}` }

// A Node that takes each stream offer and ends TLS on it, as the Node's preview server does, answering
// every request with the same text. `wire` keeps what crossed the relay, which is what the relay could read.
async function registerNode(options: { answer?: boolean } = {}) {
  const { keyPem, certPem } = ensureCert(dir)
  const offers: Offer[] = []
  const wire: Buffer[] = []
  const decrypted: string[] = []
  const control = new WebSocket(relayUrls.node(`ws://127.0.0.1:${relay.port}`, ROUTE), { headers })
  control.on('error', () => {})
  cleanup.push(() => control.terminate())
  await new Promise((resolve) => control.once('open', resolve))
  control.on('message', (data) => {
    const message = relayControlMessageSchema.parse(JSON.parse(data.toString()))
    if (message.type !== 'stream') return
    offers.push(message)
    if (options.answer === false) return
    const leg = new WebSocket(relayUrls.accept(`ws://127.0.0.1:${relay.port}`, ROUTE, message.id), { headers })
    leg.on('error', () => {})
    cleanup.push(() => leg.terminate())
    leg.on('message', (data) => wire.push(Buffer.from(data as Buffer)))
    leg.once('open', () => {
      const tls = new TLSSocket(createWebSocketStream(leg), { isServer: true, key: keyPem, cert: certPem })
      tls.on('error', () => {})
      tls.on('data', (chunk) => {
        decrypted.push(chunk.toString())
        tls.write(`you said ${chunk}`)
      })
    })
  })
  return { offers, wire, decrypted }
}

const name = (preview = 'abc123', node = label, domain = DOMAIN): string => `${preview}.${node}.${domain}`

function browser(serverName: string, options: ConnectionOptions = {}): TLSSocket {
  const socket = tlsConnect({
    host: '127.0.0.1',
    port: relay.previewPort!,
    servername: serverName,
    rejectUnauthorized: false,
    ...options,
  })
  socket.on('error', () => {})
  cleanup.push(() => socket.destroy())
  return socket
}

const closed = (socket: { once(event: 'close', listener: () => void): unknown }): Promise<void> =>
  new Promise((resolve) => socket.once('close', resolve))

describe('the relay on a preview domain', () => {
  it("carries a browser's TLS connection to the Node that ends it, and sees only ciphertext", async () => {
    const node = await registerNode()
    const client = browser(name())
    const answer = new Promise<string>((resolve) => client.once('data', (chunk) => resolve(chunk.toString())))
    client.write('GET /secret-path HTTP/1.1')

    expect(await answer).toBe('you said GET /secret-path HTTP/1.1')
    expect(node.offers).toEqual([{ type: 'stream', id: expect.stringMatching(/^[0-9a-f]{32}$/), kind: 'preview' }])
    expect(node.decrypted.join('')).toContain('secret-path')
    // The first bytes across are the ClientHello, as the relay read them, and nothing after is readable.
    const crossed = Buffer.concat(node.wire)
    expect(crossed[0]).toBe(0x16)
    expect(crossed.toString('latin1')).not.toContain('secret-path')
    expect(crossed.toString('latin1')).not.toContain('you said')
  })

  it('closes a name it does not serve, without asking any Node', async () => {
    const node = await registerNode()
    const stranger = await previewNodeLabel('another-node')
    const shapes = [
      name('abc123', stranger),
      name('abc123', label, 'other.test'),
      `${label}.${DOMAIN}`,
      `a.b.${label}.${DOMAIN}`,
    ]
    for (const shape of shapes) await closed(browser(shape))
    expect(node.offers).toEqual([])
  })

  it('closes a connection that is not TLS, and one that says nothing', async () => {
    const node = await registerNode()
    const plain = createConnection(relay.previewPort!, '127.0.0.1')
    plain.on('error', () => {})
    cleanup.push(() => plain.destroy())
    plain.write('GET / HTTP/1.1\r\nHost: abc.example\r\n\r\n')
    await closed(plain)
    expect(node.offers).toEqual([])
  })

  it('closes the browser when the Node never opens its end', async () => {
    await registerNode({ answer: false })
    await closed(browser(name()))
  })

  it('gives preview streams a limit of their own', async () => {
    const node = await registerNode({ answer: false })
    const clients = Array.from({ length: 34 }, () => browser(name()))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(node.offers).toHaveLength(32)
    expect(clients.filter((client) => client.destroyed)).toHaveLength(2)
  })

  it('serves no preview names when no domain is set', async () => {
    await relay.close()
    relay = await startRelay({ auth: CREDENTIAL })
    expect(relay.previewPort).toBeUndefined()
  })
})
