import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RollbarItemDetail, RollbarItemsResponse } from '../../../../core/shared/api'
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
  last_occurrence_id: 555,
}

// Synthetic occurrence — no real value, no token, no PII.
const INSTANCE = {
  id: 555,
  timestamp: 1_700_100_000,
  occurrence: {
    body: { trace: { exception: { class: 'TypeError', message: 'token is null' }, frames: [{ filename: 'auth.ts', lineno: 84 }] } },
    request: { method: 'POST', url: '/api/login', headers: { authorization: 'SECRET' } },
  },
}

// A detail fetch = canonical item + its latest occurrence.
const mockDetailFetch = () => {
  vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson(API_ITEM)).mockResolvedValueOnce(rollbarJson(INSTANCE))
}

describe('Rollbar source (docs/integrations.md, docs/next/rollbar.md)', () => {
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

  const connect = async (name = 'acme-api'): Promise<string> => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson({ id: 7, name }))
    const res = await app.fetch(
      new Request('http://acorn.test/api/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'rollbar', token: 'read-token' }),
      }),
      env(),
    )
    expect(res.status).toBe(200)
    return ((await res.json()) as { integration: { id: string } }).integration.id
  }

  it('connect validates via one API call and encrypts the token at rest', async () => {
    const id = await connect()
    const [row] = await t.db.select().from(schema.integrations)
    expect(row.id).toBe(id)
    expect(row.authRef).not.toContain('read-token')
    expect(JSON.parse(row.config)).toEqual({ projectId: '7' })

    const listed = await app.fetch(new Request('http://acorn.test/api/integrations'), env())
    expect(await listed.text()).not.toContain('read-token')
  })

  it('invalid token → clean 4xx', async () => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('nope', { status: 401 }))
    const res = await app.fetch(
      new Request('http://acorn.test/api/integrations', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'rollbar', token: 'bad' }),
      }),
      env(),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'provider_needs_auth' })
  })

  it('items list returns summaries with itemId + label, caches, and serves the cache within TTL', async () => {
    const integrationId = await connect()
    vi.mocked(rollbarFetch).mockResolvedValueOnce(rollbarJson({ items: [API_ITEM] }))
    const res = await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())
    expect(res.status).toBe(200)
    const body = (await res.json()) as RollbarItemsResponse
    expect(body.items).toEqual([
      {
        integrationId,
        integrationLabel: 'Rollbar · acme-api',
        identifier: '142',
        itemId: '999',
        title: 'TypeError: token is null',
        level: 'error',
        environment: 'prod',
        status: 'active',
        totalOccurrences: 142,
        firstOccurrenceAt: 1_700_000_000_000,
        lastOccurrenceAt: 1_700_100_000_000,
      },
    ])
    expect(body.failures).toEqual([])
    expect(body.cappedIntegrationIds).toEqual([])

    const cached = await t.db.select().from(schema.issues)
    expect(cached).toHaveLength(1)
    expect(cached[0]).toMatchObject({ provider: 'rollbar', identifier: '142', integrationId })

    const before = vi.mocked(rollbarFetch).mock.calls.length
    const res2 = await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())
    expect(res2.status).toBe(200)
    expect(vi.mocked(rollbarFetch).mock.calls.length).toBe(before)
  })

  it('never persists raw request headers/body in the item cache', async () => {
    const integrationId = await connect()
    mockDetailFetch()
    await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    await settleBackground()
    const rows = await t.db.select().from(schema.issues)
    expect(rows.map((r) => r.data).join('')).not.toContain('SECRET')
    expect(rows.map((r) => r.data).join('')).not.toContain('authorization')
  })

  it('item detail returns normalized latest occurrence (no raw payload) and honors refresh=true', async () => {
    const integrationId = await connect()
    mockDetailFetch()
    const res = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    expect(res.status).toBe(200)
    const detail = (await res.json()) as RollbarItemDetail
    expect(detail).toMatchObject({ identifier: '142', itemId: '999', level: 'error', url: null })
    expect(detail.latestOccurrence).toMatchObject({ kind: 'trace', exceptionClass: 'TypeError', message: 'token is null' })
    expect(JSON.stringify(detail)).not.toContain('SECRET')
    await settleBackground()

    // refresh=true forces a fresh read past the TTL.
    const before = vi.mocked(rollbarFetch).mock.calls.length
    mockDetailFetch()
    const forced = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}&refresh=true`), env())
    expect(forced.status).toBe(200)
    expect(vi.mocked(rollbarFetch).mock.calls.length).toBeGreaterThan(before)
  })

  it('detail falls back to stale cache when a background refresh fails', async () => {
    const integrationId = await connect()
    mockDetailFetch()
    await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    await settleBackground()

    await t.db.update(schema.issues).set({ fetchedAt: Date.now() - ROLLBAR_ITEMS_STALE_AFTER_MS - 1 })
    vi.mocked(rollbarFetch).mockResolvedValue(new Response('boom', { status: 500 }))
    const res = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    expect(res.status).toBe(200)
    expect(((await res.json()) as RollbarItemDetail).identifier).toBe('142')
  })

  it('legacy counter-only link resolves to the canonical item', async () => {
    const integrationId = await connect()
    // No prior list/summary → detail must resolve via item_by_counter, which still returns id 999.
    mockDetailFetch()
    const res = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    expect(res.status).toBe(200)
    expect(((await res.json()) as RollbarItemDetail).itemId).toBe('999')
  })

  it('partial success: one connection fails, the other still returns items', async () => {
    const good = await connect('good')
    const bad = await connect('bad')
    // Order of connections is by creation; both listed. Mock: good succeeds, bad 500s.
    vi.mocked(rollbarFetch)
      .mockResolvedValueOnce(rollbarJson({ items: [API_ITEM] }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const res = await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())
    expect(res.status).toBe(200)
    const body = (await res.json()) as RollbarItemsResponse
    expect(body.items).toHaveLength(1)
    expect(body.failures).toEqual([{ integrationId: bad, code: 'provider_unavailable' }])
    expect(good).not.toBe(bad)
  })

  it('all connections fail → hard error', async () => {
    await connect()
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const res = await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())
    expect(res.status).toBe(502)
  })

  it('reports capped when three full pages are returned', async () => {
    const integrationId = await connect()
    const page = (start: number) => ({ items: Array.from({ length: 100 }, (_, i) => ({ ...API_ITEM, id: start + i, counter: start + i })) })
    vi.mocked(rollbarFetch)
      .mockResolvedValueOnce(rollbarJson(page(1)))
      .mockResolvedValueOnce(rollbarJson(page(101)))
      .mockResolvedValueOnce(rollbarJson(page(201)))
    const res = await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())
    expect(res.status).toBe(200)
    const body = (await res.json()) as RollbarItemsResponse
    expect(body.items).toHaveLength(300)
    expect(body.cappedIntegrationIds).toEqual([integrationId])
  })

  it('missing integration id → 400; not connected → 403', async () => {
    expect((await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())).status).toBe(403)
    await connect()
    expect((await app.fetch(new Request('http://acorn.test/api/rollbar/items/142'), env())).status).toBe(400)
  })

  it('item not found → 404', async () => {
    const integrationId = await connect()
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('nope', { status: 404 }))
    const res = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/999?integration=${integrationId}`), env())
    expect(res.status).toBe(404)
  })

  it('disconnect performs the core cascade', async () => {
    const integrationId = await connect()
    const now = Date.now()
    await t.db.insert(schema.taskLinks).values({ taskId: 'task-1', integrationId, provider: 'rollbar', identifier: '142', createdAt: now })
    const disconnected = await app.fetch(new Request(`http://acorn.test/api/integrations/${integrationId}`, { method: 'DELETE' }), env())
    expect(disconnected.status).toBe(204)
    expect(await t.db.select().from(schema.integrations)).toEqual([])
    expect(await t.db.select().from(schema.taskLinks)).toEqual([])
  })
})

it('encryptSecret round-trip stays available to the connect path', async () => {
  const sealed = await encryptSecret('read-token', ENC_KEY)
  expect(sealed).not.toContain('read-token')
})
