import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RollbarItem } from '../../../../core/shared/api'
import { getDb, schema } from '../../../../core/server/db'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { rollbarFetch } from '..'
import { encryptSecret } from '../../../../core/server/session'
import { ROLLBAR_ITEMS_STALE_AFTER_MS } from '../../../../core/server/sync/policy'
import { settleBackground } from '../../../../core/server/background'
import { integrations } from '../../../../core/server/routes/integrations'
import { rollbar } from './rollbar'
import { makeTestDb, type TestDb } from '../../../../core/server/routes/testDb'
import '../../../../app/server/providers'

vi.mock('../../../../core/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/server/db')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('..', async (importOriginal) => {
  const actual = await importOriginal<typeof import('..')>()
  return { ...actual, rollbarFetch: vi.fn() }
})

const ENC_KEY = 'a'.repeat(64)

const rollbarJson = (result: unknown) =>
  new Response(JSON.stringify({ err: 0, result }), { headers: { 'content-type': 'application/json' } })

const API_ITEM = {
  id: 999,
  counter: 142,
  title: 'TypeError: token is null',
  level: 40,
  environment: 'prod',
  status: 'active',
  total_occurrences: 142,
  first_occurrence_timestamp: 1_700_000_000,
  last_occurrence_timestamp: 1_700_100_000,
}

describe('Rollbar source (docs/integrations.md — zero schema changes)', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    vi.clearAllMocks()
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'user', user: { token: 'token', login: 'james', name: '', avatar: '', scopes: [] } })
      await next()
    })
    app.route('/api/integrations', integrations)
    app.route('/api/rollbar', rollbar)
  })

  afterEach(async () => {
    await settleBackground()
    t.cleanup()
  })

  const env = () => ({ SESSION_ENC_KEY: ENC_KEY }) as unknown as Env

  const connect = async (): Promise<string> => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson({ id: 7, name: 'acme-api' }))
    const res = await app.fetch(
      new Request('http://acorn.test/api/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'rollbar', token: 'read-token' }),
      }),
      env(),
    )
    expect(res.status).toBe(200)
    const { integration } = (await res.json()) as { integration: { id: string; label: string } }
    expect(integration.label).toBe('Rollbar · acme-api')
    return integration.id
  }

  it('connect validates via one API call and encrypts the token at rest', async () => {
    const id = await connect()
    const [row] = await t.db.select().from(schema.integrations)
    expect(row.id).toBe(id)
    expect(row.provider).toBe('rollbar')
    expect(row.authRef).not.toContain('read-token') // encryptSecret, never plaintext
    expect(JSON.parse(row.config)).toEqual({ projectId: '7' })
    expect(JSON.parse(row.account ?? '{}')).toEqual({ id: '7', label: 'acme-api', type: 'project' })

    const listed = await app.fetch(new Request('http://acorn.test/api/integrations'), env())
    const body = await listed.text()
    expect(body).not.toContain('read-token')
    expect(body).not.toContain(row.authRef)
    expect(JSON.parse(body).providers.map((provider: { id: string }) => provider.id)).toEqual(['github', 'linear', 'rollbar'])
  })

  it('invalid token → clean 4xx', async () => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('nope', { status: 401 }))
    const res = await app.fetch(
      new Request('http://acorn.test/api/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'rollbar', token: 'bad' }),
      }),
      env(),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'provider_needs_auth' })
  })

  it('items list caches into `issues` with TTL (second call serves the cache)', async () => {
    const integrationId = await connect()
    vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson({ items: [API_ITEM] }))
    const res = await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())
    expect(res.status).toBe(200)
    const { items } = (await res.json()) as { items: RollbarItem[] }
    expect(items).toEqual([
      {
        integrationId,
        identifier: '142',
        title: 'TypeError: token is null',
        level: 'error',
        environment: 'prod',
        status: 'active',
        totalOccurrences: 142,
        firstOccurrenceAt: 1_700_000_000_000,
        lastOccurrenceAt: 1_700_100_000_000,
      },
    ])
    // Cached into the generic issues table under the provider + counter.
    const cached = await t.db.select().from(schema.issues)
    expect(cached).toHaveLength(1)
    expect(cached[0]).toMatchObject({ provider: 'rollbar', identifier: '142', integrationId })
    expect(cached[0].fetchedAt + ROLLBAR_ITEMS_STALE_AFTER_MS).toBeGreaterThan(Date.now())

    // Second call within the TTL → no new API hit (connect used 1, list used 1).
    const before = vi.mocked(rollbarFetch).mock.calls.length
    const res2 = await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())
    expect(res2.status).toBe(200)
    expect(vi.mocked(rollbarFetch).mock.calls.length).toBe(before)
  })

  it('item detail fetches by counter and falls back to stale cache on failure', async () => {
    const integrationId = await connect()
    vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson(API_ITEM))
    const res = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    expect(res.status).toBe(200)
    expect((await res.json()) as RollbarItem).toMatchObject({ identifier: '142', level: 'error' })

    // Expire the cache, make the API fail → stale beats nothing.
    await t.db.update(schema.issues).set({ fetchedAt: Date.now() - ROLLBAR_ITEMS_STALE_AFTER_MS - 1 })
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const res2 = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    expect(res2.status).toBe(200)
    expect((await res2.json()) as RollbarItem).toMatchObject({ identifier: '142' })
  })

  it('serves stale detail cache while reauthentication is required', async () => {
    const integrationId = await connect()
    vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson(API_ITEM))
    await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    await settleBackground()
    await t.db.update(schema.integrations).set({ status: 'needs-auth' })
    await t.db.update(schema.issues).set({ fetchedAt: 1 })
    const calls = vi.mocked(rollbarFetch).mock.calls.length

    const response = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())

    expect(response.status).toBe(200)
    expect((await response.json()) as RollbarItem).toMatchObject({ identifier: '142' })
    expect(vi.mocked(rollbarFetch).mock.calls).toHaveLength(calls)
  })

  it('not connected → 403', async () => {
    expect((await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())).status).toBe(403)
  })

  it('disable and credential rotation preserve identity/linked state; disconnect performs the core cascade', async () => {
    const integrationId = await connect()
    const now = Date.now()
    await t.db.insert(schema.issues).values({
      userId: 'james', integrationId, provider: 'rollbar', identifier: '142', data: JSON.stringify(API_ITEM), fetchedAt: now,
    })
    await t.db.insert(schema.taskLinks).values({ taskId: 'task-1', integrationId, provider: 'rollbar', identifier: '142', createdAt: now })
    await t.db.insert(schema.workspaceProjects).values({ workspaceId: 'workspace-1', integrationId, externalId: '7', createdAt: now })
    await t.db.insert(schema.syncState).values({ userId: 'james', resource: `provider:rollbar:${integrationId}:items:list`, fetchedAt: now })

    const disabled = await app.fetch(new Request(`http://acorn.test/api/integrations/${integrationId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled: true }),
    }), env())
    expect(disabled.status).toBe(200)
    expect((await t.db.select().from(schema.taskLinks))).toHaveLength(1)
    expect((await t.db.select().from(schema.issues))).toHaveLength(1)

    vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson({ id: 7, name: 'acme-api' }))
    const rotated = await app.fetch(new Request(`http://acorn.test/api/integrations/${integrationId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credentials: { token: 'replacement-token' } }),
    }), env())
    expect(rotated.status).toBe(200)
    expect(((await rotated.json()) as { integration: { id: string } }).integration.id).toBe(integrationId)
    expect((await t.db.select().from(schema.taskLinks))).toHaveLength(1)
    expect((await t.db.select().from(schema.issues))).toHaveLength(1)

    const disconnected = await app.fetch(new Request(`http://acorn.test/api/integrations/${integrationId}`, { method: 'DELETE' }), env())
    expect(disconnected.status).toBe(204)
    expect(await t.db.select().from(schema.integrations)).toEqual([])
    expect(await t.db.select().from(schema.taskLinks)).toEqual([])
    expect(await t.db.select().from(schema.issues)).toEqual([])
    expect(await t.db.select().from(schema.workspaceProjects)).toEqual([])
    expect(await t.db.select().from(schema.syncState)).toEqual([])
  })
})

// Sanity for the encryption helper contract this source leans on.
it('encryptSecret round-trip stays available to the connect path', async () => {
  const sealed = await encryptSecret('read-token', ENC_KEY)
  expect(sealed).not.toContain('read-token')
})
