import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppEnv, Principal } from '../middleware/auth'
import { TokenService } from '../publicApi/tokenService'
import { apiTokens } from './apiTokens'
import { makeTestDb, type TestDb } from './testDb'

const principal: Principal = { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } }

describe('internal /api/api-tokens admin route', () => {
  let t: TestDb
  let env: Env
  let app: Hono<AppEnv>

  beforeEach(() => {
    t = makeTestDb()
    env = { API_TOKENS: new TokenService(t.db) } as unknown as Env
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', principal)
      await next()
    })
    app.route('/api/api-tokens', apiTokens)
  })
  afterEach(() => t.cleanup())

  const call = (path: string, init?: RequestInit) => app.fetch(new Request(`http://acorn.test${path}`, init), env)

  it('creates a token (raw shown once), lists metadata, and revokes it', async () => {
    const created = await call('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ci', scopes: ['read', 'write'] }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { token: string; metadata: { id: string } }
    expect(body.token).toMatch(/^acorn_v1_/)

    const list = await (await call('/api/api-tokens')).json()
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(body.token)

    const del = await call(`/api/api-tokens/${body.metadata.id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    // revoked token is no longer authenticatable
    expect(await new TokenService(t.db).authenticate(body.token)).toBeNull()
  })

  it('rejects an invalid scope set and a past expiry', async () => {
    const bad = await call('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['write'] }),
    })
    expect(bad.status).toBe(400)

    const past = await call('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['read'], expiresAt: 1 }),
    })
    expect(past.status).toBe(400)
  })

  it('404s revoking a token that is not the current user’s', async () => {
    const res = await call('/api/api-tokens/00000000-0000-0000-0000-000000000000', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
