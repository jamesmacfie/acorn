import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../server/routes/testDb'
import { TokenService } from '../../server/publicApi/tokenService'
import { AutomationApiServer } from './server'
import { ApiSettingsStore } from './settingsStore'

// Real loopback binds. Uses uncommon ports to avoid collisions with a running dev server.
const PORT_A = 47318
const PORT_B = 47319

function runtimeInfo() {
  return {
    version: '9.9.9',
    startedAt: 1000,
    desktop: true,
    reconciliationComplete: () => true,
    rendererConnected: () => false,
    terminalAvailable: () => true,
    worktreesAvailable: () => true,
    pluginCapabilities: () => [],
  }
}

describe('AutomationApiServer lifecycle', () => {
  let dir: string
  let t: TestDb
  let token: string
  let server: AutomationApiServer

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-api-server-'))
    t = makeTestDb()
    const tokens = new TokenService(t.db)
    token = (await tokens.create({ userId: 'u', name: 'w', scopes: ['read', 'write'], expiresAt: null })).token
    const store = new ApiSettingsStore(dir, {})
    store.write({ enabled: true, port: PORT_A })
    server = new AutomationApiServer({
      settingsStore: store,
      bindings: { DB: t.db } as unknown as Env,
      tokens,
      version: '9.9.9',
      runtime: runtimeInfo(),
    })
  })

  afterEach(async () => {
    await server.stop()
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const health = (port: number) =>
    fetch(`http://127.0.0.1:${port}/api/v1/health`, { headers: { authorization: `Bearer ${token}` } })

  it('binds, serves bearer-authed health, and enforces the Host guard', async () => {
    await server.start()
    const ok = await health(PORT_A)
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.version).toBe('9.9.9')

    // wrong Host is rejected before Hono. fetch forbids overriding Host, so use a raw request.
    const badStatus = await new Promise<number>((resolve, reject) => {
      const req = request(
        { hostname: '127.0.0.1', port: PORT_A, path: '/api/v1/health', headers: { authorization: `Bearer ${token}`, host: 'evil.test' } },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(badStatus).toBe(403)
  })

  it('rebinds transactionally on a port change', async () => {
    await server.start()
    const result = await server.patch({ port: PORT_B })
    expect(result.rebound).toBe(true)
    expect(result.port).toBe(PORT_B)
    // new port serves
    const onNew = await health(PORT_B)
    expect(onNew.status).toBe(200)
    // give the deferred close of the old listener a tick to run
    await new Promise((r) => setTimeout(r, 50))
    await expect(health(PORT_A)).rejects.toBeDefined()
  })

  it('refuses a port change pinned by ACORN_API_PORT', async () => {
    const overridden = new AutomationApiServer({
      settingsStore: new ApiSettingsStore(dir, { ACORN_API_PORT: String(PORT_A) }),
      bindings: { DB: t.db } as unknown as Env,
      tokens: new TokenService(t.db),
      version: '9.9.9',
      runtime: runtimeInfo(),
    })
    await expect(overridden.patch({ port: PORT_B })).rejects.toMatchObject({ code: 'setting_overridden' })
    await overridden.stop()
  })
})
