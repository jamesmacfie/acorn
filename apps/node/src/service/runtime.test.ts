import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import type { ServiceState } from '@acorn/protocol/serviceProtocol.ts'

function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('No test port assigned'))
      server.close(() => resolve(address.port))
    })
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

  // The real built renderer: this test asserts the service serves the SPA shell, so it needs an
  // actual index.html rather than a stub. The renderer is owned and built by apps/desktop, so this
  // reaches across to its build output — a filesystem path, not an import, which is why it does not
  // violate the "apps never import each other" boundary. It does mean a desktop renderer build must
  // have happened at least once.
  const clientDir = resolve(import.meta.dirname, '../../../desktop/dist/client')

  const startRuntime = async (opts: { dataDir: string; deviceToken?: string; onState?: (s: ServiceState) => void }) => {
    const { startServiceRuntime } = await import('./runtime')
    return startServiceRuntime({
      config: {
        dataDir: opts.dataDir,
        clientDir,
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

  const seedEnv = async (): Promise<number> => {
    const port = await unusedPort()
    process.env.ACORN_PORT = String(port)
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    process.env.GITHUB_CLIENT_ID = 'test-client'
    process.env.GITHUB_CLIENT_SECRET = 'test-secret'
    return port
  }

  it('migrates, serves the SPA, reconciles, and drains without Electron or GitHub', async () => {
    const port = await seedEnv()
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
      // The endpoint is reported, not assumed: the parent no longer computes an origin before the
      // child exists, which is what lets two nodes coexist on one machine.
      expect(runtime.started.endpoint).toEqual({ origin: `http://127.0.0.1:${port}`, port })
      expect(runtime.started.nodeId).toMatch(/^[0-9a-f-]{36}$/)
      expect(runtime.started.deviceToken).toMatch(/^acorn_dt_/)

      const response = await fetch(runtime.started.endpoint.origin)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<!doctype html>')
      await ready
      expect(states).toEqual(['migrating', 'listening', 'reconciling', 'ready'])
    } finally {
      await runtime.stop()
    }
    expect(states.at(-1)).toBe('stopped')
  }, 15_000)

  // Without reuse the bundled client would accrue one device row per launch, and the device list
  // would be useless within a week.
  it('reuses a remembered device token across restarts, and replaces an unknown one', async () => {
    await seedEnv()
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-service-'))

    const first = await startRuntime({ dataDir })
    const token = first.started.deviceToken
    await first.stop()

    await seedEnv()
    const second = await startRuntime({ dataDir, deviceToken: token })
    expect(second.started.deviceToken).toBe(token)
    await second.stop()

    await seedEnv()
    const third = await startRuntime({ dataDir, deviceToken: 'acorn_dt_not-a-real-token' })
    expect(third.started.deviceToken).not.toBe('acorn_dt_not-a-real-token')
    expect(third.started.deviceToken).toMatch(/^acorn_dt_/)
    await third.stop()
  }, 30_000)
})
