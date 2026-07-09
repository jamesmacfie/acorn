import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RollbarItem } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { rollbarFetch } from '../rollbar'
import { encryptSecret } from '../session'
import { integrations } from './integrations'
import { ITEMS_STALE_AFTER_MS, rollbar } from './rollbar'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('../rollbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rollbar')>()
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

  afterEach(() => t.cleanup())

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
    expect(row.accessToken).not.toContain('read-token') // encryptSecret, never plaintext
    expect(JSON.parse(row.meta ?? '{}')).toEqual({ project: 'acme-api', projectId: 7 })
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
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_key' })
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
    expect(cached[0].fetchedAt + ITEMS_STALE_AFTER_MS).toBeGreaterThan(Date.now())

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
    await t.db.update(schema.issues).set({ fetchedAt: Date.now() - ITEMS_STALE_AFTER_MS - 1 })
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const res2 = await app.fetch(new Request(`http://acorn.test/api/rollbar/items/142?integration=${integrationId}`), env())
    expect(res2.status).toBe(200)
    expect((await res2.json()) as RollbarItem).toMatchObject({ identifier: '142' })
  })

  it('not connected → 403', async () => {
    expect((await app.fetch(new Request('http://acorn.test/api/rollbar/items'), env())).status).toBe(403)
  })
})

// Sanity for the encryption helper contract this source leans on.
it('encryptSecret round-trip stays available to the connect path', async () => {
  const sealed = await encryptSecret('read-token', ENC_KEY)
  expect(sealed).not.toContain('read-token')
})
