import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
import { prActions } from './prActions'
import { testGate } from '@acorn/node-core/testkit/auth.ts'
import { makeTestDb, makeTestPluginDb, testSecretEnv, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { migrationsDir } from '../../node/migrations'
import type { Env } from '@acorn/node-core/main/bindings.ts'
import { repos } from '../../node/schema'

const ENC_KEY = '0'.repeat(64)

const PRINCIPAL: Principal = { kind: 'device', userId: 'james', deviceId: 'd1' }

let core: TestDb
let plugin: TestPluginDb

const req = (principal: Principal | null, method: string, path: string, body?: unknown) => {
  const app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/repos', prActions(plugin.db))
  return app.fetch(
    new Request(`http://acorn.test${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: core.db, ...testSecretEnv(ENC_KEY) } as Env,
  )
}

describe('prActions auth + ApiError envelope (no GitHub call paths)', () => {
  beforeEach(async () => {
    core = makeTestDb()
    plugin = makeTestPluginDb('github', migrationsDir())
    await plugin.db.insert(repos).values({ userId: 'james', id: 1, owner: 'acme', name: 'widget', fetchedAt: Date.now() })
  })
  afterEach(() => {
    plugin.cleanup()
    core.cleanup()
  })

  it('401s (ApiError) when logged out', async () => {
    const res = await req(null, 'POST', '/api/repos/acme/widget/pulls/1/merge', { method: 'merge' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'unauthenticated' })
  })

  it('repo_not_found (ApiError) when the repo is not mirrored — resolvePr fails before GitHub', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/other/repo/pulls/1/merge', { method: 'merge' })
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'repo_not_found' })
  })

  it('bad_number (ApiError) for a non-integer PR number', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/abc/merge', { method: 'merge' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'bad_number' })
  })

  it('empty_body (ApiError) — resolvePr succeeds, validation rejects before GitHub', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/comments', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'empty_body' })
  })

  it('viewed toggle is app-state only → typed success, no GitHub call', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/viewed', { path: 'src/a.ts', viewed: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: 'src/a.ts', viewed: true })
  })
})
