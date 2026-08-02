import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('migrates, serves the SPA, reconciles, and drains without Electron or GitHub', async () => {
    const port = await unusedPort()
    const origin = `http://127.0.0.1:${port}`
    process.env.ACORN_PORT = String(port)
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    process.env.GITHUB_CLIENT_ID = 'test-client'
    process.env.GITHUB_CLIENT_SECRET = 'test-secret'
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-service-'))

    const states: ServiceState[] = []
    let markReady!: () => void
    const ready = new Promise<void>((resolve) => (markReady = resolve))
    const { startServiceRuntime } = await import('./runtime')
    const runtime = await startServiceRuntime({
      config: {
        dataDir,
        origin,
        version: 'test',
        isPackaged: false,
        electronPath: process.execPath,
        mcpEntry: '/unused/mcp.js',
      },
      desktop,
      stateChanged: (state) => {
        states.push(state)
        if (state === 'ready') markReady()
      },
    })

    try {
      const response = await fetch(origin)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<!doctype html>')
      await ready
      expect(states).toEqual(['migrating', 'listening', 'reconciling', 'ready'])
    } finally {
      await runtime.stop()
    }
    expect(states.at(-1)).toBe('stopped')
  }, 15_000)
})
