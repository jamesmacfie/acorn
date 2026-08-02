import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import type { HttpRequest, HttpVariable } from '../../shared/model'
import { http } from './http'
import type { Env } from '@acorn/node-core/main/bindings.ts'

const ENC_KEY = '0'.repeat(64)
const requestBody = {
  folder: '',
  taskId: null,
  name: 'Private API',
  method: 'POST',
  url: 'https://api.example.test/items?token=query-secret',
  headers: [{ name: 'Authorization', value: 'Bearer header-secret', enabled: true }],
  bodyMode: 'json',
  body: '{"password":"body-secret"}',
  auth: { mode: 'bearer', token: 'auth-secret' },
  vars: { TOKEN: 'override-secret' },
}

const principal = (login: string, kind: Principal['kind'] = 'user'): Principal => ({
  kind,
  user: { token: kind === 'user' ? 'github-token' : '', login, name: login, avatar: '', scopes: [] },
})

describe('HTTP credential isolation', () => {
  let testDb: TestDb
  let env: Env

  beforeEach(() => {
    testDb = makeTestDb()
    env = { DB: testDb.db, SESSION_ENC_KEY: ENC_KEY } as unknown as Env
  })

  afterEach(() => testDb.cleanup())

  const call = (caller: Principal, path: string, init?: RequestInit) => {
    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', caller)
      await next()
    })
    app.route('/api/http', http)
    return app.fetch(new Request(`http://acorn.test${path}`, init), env)
  }

  it('encrypts saved request payloads and returns them only to their owner', async () => {
    const created = await call(principal('alice'), '/api/http/acme/web/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    expect(created.status).toBe(201)
    expect((await created.json()) as HttpRequest).toMatchObject(requestBody)

    const [stored] = await testDb.db.select().from(schema.httpRequests)
    expect(stored).toMatchObject({ userId: 'alice', encrypted: true })
    const raw = JSON.stringify(stored)
    for (const secret of ['query-secret', 'header-secret', 'body-secret', 'auth-secret', 'override-secret']) {
      expect(raw).not.toContain(secret)
    }

    const alice = (await (await call(principal('alice'), '/api/http/acme/web/requests')).json()) as HttpRequest[]
    expect(alice).toHaveLength(1)
    expect(alice[0]).toMatchObject(requestBody)
    expect(await (await call(principal('bob'), '/api/http/acme/web/requests')).json()).toEqual([])
  })

  it('encrypts every variable kind, masks secrets, and scopes names per user', async () => {
    const create = (login: string, kind: 'value' | 'secret' | 'command', value: string) =>
      call(principal(login), '/api/http/acme/web/vars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'TOKEN', kind, value, enabled: true }),
      })

    const alice = await create('alice', 'secret', 'alice-secret')
    const bob = await create('bob', 'value', 'bob-value')
    expect(alice.status).toBe(201)
    expect(bob.status).toBe(201)
    expect(((await alice.json()) as HttpVariable).value).toBe('')

    const stored = await testDb.db.select().from(schema.httpVariables)
    expect(stored).toHaveLength(2)
    expect(JSON.stringify(stored)).not.toContain('alice-secret')
    expect(JSON.stringify(stored)).not.toContain('bob-value')
    expect(stored.every((row) => row.encrypted)).toBe(true)

    const bobRows = (await (await call(principal('bob'), '/api/http/acme/web/vars')).json()) as HttpVariable[]
    expect(bobRows).toMatchObject([{ name: 'TOKEN', kind: 'value', value: 'bob-value' }])
  })

  it('rejects the machine internal principal before it can read or send credentials', async () => {
    const response = await call(principal('alice', 'internal'), '/api/http/acme/web/requests')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'interactive_user_required' })
  })
})
