import { request as httpsRequest } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedTlsCert } from '../../testkit/tls.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDataRoot, type DataRoot } from '../storage/dataRoot'
import { makeRuntime, startListener, type Listener } from './listener'
import { disposeWsHub } from './wsHub'
import { mintInternalToken } from '../auth/internalTokens'
import { startRelayTunnel } from './relayTunnel'

// The tunnel dials out, so here it only records whether the listener started it.
vi.mock('./relayTunnel', async () => ({
  relayHost: (await import('@acorn/protocol/relay.ts')).relayHost,
  startRelayTunnel: vi.fn(() => ({ close() {} })),
}))

// The listener's transport contract, asserted against a real socket: it speaks TLS with the
// certificate it reports, that certificate validates for 127.0.0.1 (no `rejectUnauthorized: false`
// anywhere: in that mode Node skips checkServerIdentity entirely, so a pin would silently never be
// checked), and the loopback Host guard uses the port it actually bound, because the port is
// ephemeral.

type Probe = { status: number; body: string }

// Full verification: `ca` is the node's own self-signed certificate, which is what makes the chain
// valid, and the hostname check then has to pass on the IP:127.0.0.1 SAN. If either is wrong this
// rejects, which is the whole point, because the MCP child (docs/mcp.md) trusts the same file the
// same way.
//
// A relay name isn't in the certificate, because a relayed client pins instead of checking names, so
// a probe that sends one passes `anyName`. The chain is still checked against the node's certificate.
function probe(
  listener: Listener,
  path: string,
  host?: string,
  headers: Record<string, string> = {},
  anyName = false,
): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: listener.endpoint.port,
        path,
        method: 'GET',
        ca: [listener.certPem],
        rejectUnauthorized: true,
        agent: false, // a fresh connection per probe, so no pooled socket carries a previous request's terms
        ...(anyName ? { checkServerIdentity: () => undefined } : {}),
        headers: { ...(host ? { host } : {}), ...headers },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('the loopback TLS listener', () => {
  const original = { port: process.env.ACORN_PORT, key: process.env.SESSION_ENC_KEY }
  let dataDir: string | null = null
  let root: DataRoot | null = null
  let listener: Listener | null = null
  // Every runtime this suite opens, so the SQLite handles close before the temp root is removed.
  const opened: Array<{ close(): void }> = []

  beforeEach(() => {
    // No ACORN_PORT: the point of this suite is the ephemeral-port path the app uses.
    delete process.env.ACORN_PORT
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-listener-'))
    root = openDataRoot(dataDir)
    // The listener's own ensureCert call would mint a fresh RSA pair per test otherwise. Admit the
    // empty root first; a certificate written before node.json is correctly treated as old state.
    seedTlsCert(dataDir)
  })

  afterEach(async () => {
    if (listener) {
      disposeWsHub(listener.server as unknown as import('node:http').Server)
      await new Promise<void>((resolve) => listener!.server.close(() => resolve()))
      listener = null
    }
    for (const db of opened.splice(0)) db.close()
    root?.release()
    root = null
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
    for (const [name, value] of Object.entries(original)) {
      const key = { port: 'ACORN_PORT', key: 'SESSION_ENC_KEY' }[name]!
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  })

  const start = async (): Promise<Listener> => {
    const runtime = makeRuntime(root!)
    opened.push(runtime.DB)
    listener = await startListener(runtime, root!)
    return listener
  }

  it('serves a fully validated TLS connection on an ephemeral port, and reports its own pin', async () => {
    const started = await start()
    expect(started.endpoint.origin).toBe(`https://127.0.0.1:${started.endpoint.port}`)
    expect(started.endpoint.port).toBeGreaterThan(0)
    expect(started.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // GET /v1/node is the pre-auth route a client that has never paired uses (docs/api-reference/transport.md
    // § Pairing), so it is reachable without a bearer, which makes it the right shape probe here. It
    // advertises the same fingerprint the handshake above just presented.
    const response = await probe(started, '/v1/node')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ fingerprint: started.fingerprint })
  }, 20_000)

  it('rejects an unexpected Host but accepts the port it actually bound', async () => {
    const started = await start()
    expect((await probe(started, '/v1/node', 'localhost:1234')).status).toBe(403)
    expect((await probe(started, '/v1/node', `127.0.0.1:${started.endpoint.port}`)).status).toBe(200)
  }, 20_000)

  // A Node with no relay settings loads none of the relay's code and answers to no relay name.
  it('answers to its relay name, and starts the tunnel, only with relay settings', async () => {
    const relayName = (): string => `${root!.nodeId}.relay.acorn`
    const plain = await start()
    expect((await probe(plain, '/v1/node', relayName(), {}, true)).status).toBe(403)
    expect(startRelayTunnel).not.toHaveBeenCalled()
    disposeWsHub(plain.server as unknown as import('node:http').Server)
    await new Promise<void>((resolve) => plain.server.close(() => resolve()))
    listener = null

    process.env.ACORN_RELAY_URL = 'ws://127.0.0.1:9'
    process.env.ACORN_RELAY_CREDENTIAL = 'relay-credential'
    try {
      const relayed = await start()
      // The relay name is allowed once the tunnel's module loads, just before the tunnel starts.
      await vi.waitFor(() =>
        expect(startRelayTunnel).toHaveBeenCalledWith(
          relayed.server,
          { url: 'ws://127.0.0.1:9', credential: 'relay-credential' },
          root!.nodeId,
        ),
      )
      expect((await probe(relayed, '/v1/node', relayName(), {}, true)).status).toBe(200)
    } finally {
      delete process.env.ACORN_RELAY_URL
      delete process.env.ACORN_RELAY_CREDENTIAL
    }
  }, 30_000)

  it('authenticates an internal token using the adapter socket peer', async () => {
    const started = await start()
    const token = mintInternalToken(readFileSync(join(dataDir!, 'internal-token'), 'utf8').trim(), { scope: 'service' })
    const response = await probe(started, '/v1/core/tasks', undefined, { 'x-acorn-internal': token })
    expect(response.status).toBe(200)
  }, 20_000)

  // "The Node serves no web assets" (docs/architecture-overview.md): the renderer loads from app://acorn,
  // so an HTML shell here would only invite a browser to treat the node as an origin.
  it('serves no SPA shell', async () => {
    const started = await start()
    const response = await probe(started, '/')
    expect(response.status).toBe(404)
    expect(response.body).not.toContain('<!doctype html')
  }, 20_000)

  // A restart usually keeps the same endpoint, so the client's remembered node record stays right.
  it('prefers the port this root last bound', async () => {
    const first = await start()
    const port = first.endpoint.port
    disposeWsHub(first.server as unknown as import('node:http').Server)
    await new Promise<void>((resolve) => first.server.close(() => resolve()))
    listener = null

    const second = await start()
    expect(second.endpoint.port).toBe(port)
  }, 30_000)

  // ...but never at the cost of not starting. The remembered port belongs to whoever holds it now, and
  // an ephemeral port is a perfectly good endpoint because the client is told where we bound.
  it('falls back to an ephemeral port when the remembered one is taken', async () => {
    const first = await start()
    const port = first.endpoint.port
    disposeWsHub(first.server as unknown as import('node:http').Server)
    await new Promise<void>((resolve) => first.server.close(() => resolve()))
    listener = null

    const squatter = createNetServer()
    await new Promise<void>((resolve) => squatter.listen(port, '127.0.0.1', resolve))
    try {
      const second = await start()
      expect(second.endpoint.port).not.toBe(port)
      expect((await probe(second, '/v1/node')).status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()))
    }
  }, 30_000)

  // Clients on other machines remember the address, port included, so an advertised Node would
  // rather not start than move.
  it('refuses to move an advertised Node off its remembered port, and names the holder', async () => {
    root!.recordAdvertiseHost('workshop.local')
    const first = await start()
    const port = first.endpoint.port
    disposeWsHub(first.server as unknown as import('node:http').Server)
    await new Promise<void>((resolve) => first.server.close(() => resolve()))
    listener = null

    // On every interface, as the advertised Node binds, so the clash doesn't depend on the platform's
    // rules for a wildcard beside a specific address.
    const squatter = createNetServer()
    await new Promise<void>((resolve) => squatter.listen(port, '0.0.0.0', resolve))
    try {
      await expect(start()).rejects.toThrow(new RegExp(`port ${port} is taken by .*won't start on another`))
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()))
    }
  }, 30_000)
})
