import { request as httpsRequest } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDataRoot, type DataRoot } from './dataRoot'
import { makeRuntime, startListener, type Listener } from './server'
import { disposeWsHub } from './wsHub'

// The listener's transport contract, asserted against a REAL socket: it speaks TLS with the certificate
// it reports, that certificate VALIDATES for 127.0.0.1 (no `rejectUnauthorized: false` anywhere — in
// that mode Node skips checkServerIdentity entirely, so a pin would silently never be checked), and the
// loopback Host guard still uses the port it actually bound now that the port is ephemeral.

type Probe = { status: number; body: string }

// Deliberately full verification: `ca` is the node's own self-signed certificate, which is what makes
// the chain valid, and the hostname check then has to pass on the IP:127.0.0.1 SAN. If either is wrong
// this rejects — which is the whole point, because the MCP child (docs/mcp.md) trusts the same file the
// same way.
function probe(listener: Listener, path: string, host?: string): Promise<Probe> {
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
        ...(host ? { headers: { host } } : {}),
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
  const original = { port: process.env.ACORN_PORT, key: process.env.SESSION_ENC_KEY, id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET }
  let dataDir: string | null = null
  let root: DataRoot | null = null
  let listener: Listener | null = null
  // Every runtime this suite opens, so the SQLite handles close before the temp root is removed.
  const opened: Array<{ close(): void }> = []

  beforeEach(() => {
    // No ACORN_PORT: the point of this suite is the ephemeral-port path the app now uses.
    delete process.env.ACORN_PORT
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    process.env.GITHUB_CLIENT_ID = 'test-client'
    process.env.GITHUB_CLIENT_SECRET = 'test-secret'
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-listener-'))
    root = openDataRoot(dataDir)
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
      const key = { port: 'ACORN_PORT', key: 'SESSION_ENC_KEY', id: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' }[name]!
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
    // GET /v2/node is the pre-auth route a client that has never paired uses (docs/api-reference.md
    // § Pairing), so it is reachable without a bearer — which makes it the right shape probe here. It
    // advertises the same fingerprint the handshake above just presented.
    const response = await probe(started, '/v2/node')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ fingerprint: started.fingerprint })
  }, 20_000)

  it('rejects an unexpected Host but accepts the port it actually bound', async () => {
    const started = await start()
    expect((await probe(started, '/v2/node', 'localhost:1234')).status).toBe(403)
    expect((await probe(started, '/v2/node', `127.0.0.1:${started.endpoint.port}`)).status).toBe(200)
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

  // …but never at the cost of not starting. The remembered port belongs to whoever holds it now, and an
  // ephemeral port is a perfectly good endpoint because the client is told where we bound.
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
      expect((await probe(second, '/v2/node')).status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()))
    }
  }, 30_000)
})
