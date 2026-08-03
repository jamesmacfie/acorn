import { request as httpsRequest } from 'node:https'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import type { ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'

// A fully validated request against the node's reported pin. `ca` is the node's own self-signed
// certificate; `rejectUnauthorized` stays true, so the IP:127.0.0.1 SAN has to match too.
function get(started: ServiceStartResult, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      { host: '127.0.0.1', port: started.endpoint.port, path, ca: [started.certPem], rejectUnauthorized: true },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

const desktop: DesktopCapabilities = {
  preview: {
    currentUrl: async () => null,
    loadUrl: async () => false,
    navState: async () => null,
    navigate: async () => false,
    evict: async () => false,
  },
  browser: {
    navigate: async () => ({ ok: false }),
    snapshot: async () => ({ error: 'not available' }),
    click: async () => ({ ok: false }),
    fill: async () => ({ ok: false }),
    screenshot: async () => ({ error: 'not available' }),
    console: async () => ({ lines: [] }),
  },
}

describe('Electron-free service runtime', () => {
  const original = {
    port: process.env.ACORN_PORT,
    key: process.env.SESSION_ENC_KEY,
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }
  let dataDir: string | null = null

  afterEach(() => {
    if (original.port == null) delete process.env.ACORN_PORT
    else process.env.ACORN_PORT = original.port
    if (original.key == null) delete process.env.SESSION_ENC_KEY
    else process.env.SESSION_ENC_KEY = original.key
    if (original.clientId == null) delete process.env.GITHUB_CLIENT_ID
    else process.env.GITHUB_CLIENT_ID = original.clientId
    if (original.clientSecret == null) delete process.env.GITHUB_CLIENT_SECRET
    else process.env.GITHUB_CLIENT_SECRET = original.clientSecret
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  })

  const startRuntime = async (opts: { dataDir: string; deviceToken?: string; onState?: (s: ServiceState) => void }) => {
    const { startServiceRuntime } = await import('./runtime')
    return startServiceRuntime({
      config: {
        dataDir: opts.dataDir,
        version: 'test',
        isPackaged: false,
        electronPath: process.execPath,
        mcpEntry: '/unused/mcp.js',
        deviceToken: opts.deviceToken,
      },
      desktop,
      stateChanged: (state) => opts.onState?.(state),
    })
  }

  // No ACORN_PORT: the service picks its own port now. Pinning one here would test a configuration the
  // app never uses.
  const seedEnv = (): void => {
    delete process.env.ACORN_PORT
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    process.env.GITHUB_CLIENT_ID = 'test-client'
    process.env.GITHUB_CLIENT_SECRET = 'test-secret'
  }

  it('migrates, listens over TLS, reconciles, and drains without Electron or GitHub', async () => {
    seedEnv()
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-service-'))

    const states: ServiceState[] = []
    let markReady!: () => void
    const ready = new Promise<void>((resolve) => (markReady = resolve))
    const runtime = await startRuntime({
      dataDir,
      onState: (state) => {
        states.push(state)
        if (state === 'ready') markReady()
      },
    })

    try {
      // The endpoint AND the pin are reported, not assumed: the parent no longer computes an origin
      // before the child exists, which is what lets two nodes coexist on one machine.
      expect(runtime.started.endpoint.origin).toBe(`https://127.0.0.1:${runtime.started.endpoint.port}`)
      expect(runtime.started.nodeId).toMatch(/^[0-9a-f-]{36}$/)
      expect(runtime.started.deviceToken).toMatch(/^acorn_dt_/)
      expect(runtime.started.fingerprint).toMatch(/^[0-9a-f]{64}$/)

      // The pre-auth route, over a connection validated against the reported certificate. There is no
      // SPA shell to fetch any more — the node serves no web assets.
      expect(await get(runtime.started, '/v2/node')).toBe(200)
      await ready
      expect(states).toEqual(['migrating', 'listening', 'reconciling', 'ready'])
    } finally {
      await runtime.stop()
    }
    expect(states.at(-1)).toBe('stopped')
  }, 20_000)

  // Two nodes on one machine is an ordinary case now (docs/vNext/architecture.md § Topology), and the
  // pinned port made it impossible.
  it('binds a different port, and a different identity, per data root', async () => {
    seedEnv()
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-service-a-'))
    const other = mkdtempSync(join(tmpdir(), 'acorn-service-b-'))
    const first = await startRuntime({ dataDir })
    try {
      const second = await startRuntime({ dataDir: other })
      try {
        expect(second.started.endpoint.port).not.toBe(first.started.endpoint.port)
        expect(second.started.fingerprint).not.toBe(first.started.fingerprint)
      } finally {
        await second.stop()
      }
    } finally {
      await first.stop()
      rmSync(other, { recursive: true, force: true })
    }
  }, 30_000)

  // Without reuse the bundled client would accrue one device row per launch, and the device list
  // would be useless within a week.
  it('reuses a remembered device token across restarts, and replaces an unknown one', async () => {
    seedEnv()
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-service-'))

    const first = await startRuntime({ dataDir })
    const token = first.started.deviceToken
    await first.stop()

    seedEnv()
    const second = await startRuntime({ dataDir, deviceToken: token })
    expect(second.started.deviceToken).toBe(token)
    await second.stop()

    seedEnv()
    const third = await startRuntime({ dataDir, deviceToken: 'acorn_dt_not-a-real-token' })
    expect(third.started.deviceToken).not.toBe('acorn_dt_not-a-real-token')
    expect(third.started.deviceToken).toMatch(/^acorn_dt_/)
    await third.stop()
  }, 30_000)
})
