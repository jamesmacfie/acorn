import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { RollbarItem, RollbarItemsResponse } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { itemByCounterPath, itemsPath, levelName, rollbarData, rollbarFetch, type RollbarApiItem } from '../rollbar'
import { decryptSecret } from '../session'

// /api/rollbar — the Rollbar Source's reads (docs/next 10): recent items per connection + one
// item's detail, cached into the generic `issues` table (provider 'rollbar', identifier = the
// visible counter) with serve-then-revalidate — ZERO new schema, the litmus test the Source
// contract was built for.

const PROVIDER = 'rollbar'
export const ITEMS_STALE_AFTER_MS = 120_000 // errors move fast; 2 min is fresh enough for browse

type IntegrationRow = typeof schema.integrations.$inferSelect

const rollbarRows = (c: { env: Env }, userId: string): Promise<IntegrationRow[]> =>
  getDb(c.env)
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, PROVIDER)))

const toItem = (integrationId: string, raw: RollbarApiItem): RollbarItem => ({
  integrationId,
  identifier: String(raw.counter),
  title: raw.title,
  level: levelName(raw.level),
  environment: raw.environment,
  status: raw.status,
  totalOccurrences: raw.total_occurrences,
  firstOccurrenceAt: raw.first_occurrence_timestamp ? raw.first_occurrence_timestamp * 1000 : null,
  lastOccurrenceAt: raw.last_occurrence_timestamp ? raw.last_occurrence_timestamp * 1000 : null,
})

async function cacheItem(c: { env: Env }, userId: string, item: RollbarItem, now: number): Promise<void> {
  await getDb(c.env)
    .insert(schema.issues)
    .values({ userId, integrationId: item.integrationId, provider: PROVIDER, identifier: item.identifier, data: JSON.stringify(item), fetchedAt: now })
    .onConflictDoUpdate({
      target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier],
      set: { data: JSON.stringify(item), fetchedAt: now },
    })
}

export const rollbar = new Hono<AppEnv>()
  // Recent active items across every connected Rollbar project; each cached into `issues`.
  .get('/items', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await rollbarRows(c, user.login)
    if (!rows.length) return c.json({ error: 'rollbar_not_connected' }, 403)
    const db = getDb(c.env)
    const now = Date.now()
    const out: RollbarItem[] = []
    for (const row of rows) {
      // Serve-then-revalidate: fresh cached items for this connection short-circuit the API call.
      const cached = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.integrationId, row.id), eq(schema.issues.provider, PROVIDER)))
      const freshEnough = cached.length > 0 && cached.every((r) => r.fetchedAt + ITEMS_STALE_AFTER_MS > now)
      if (freshEnough) {
        out.push(...cached.map((r) => JSON.parse(r.data) as RollbarItem))
        continue
      }
      const token = await decryptSecret(row.accessToken, c.env.SESSION_ENC_KEY)
      if (!token) continue
      // Track what this connection already contributed: a fetch can fail AFTER some items were
      // pushed, and the stale-cache fallback below must not emit those items a second time.
      const pushed = new Set<string>()
      try {
        const res = await rollbarFetch(token, itemsPath)
        const { items } = await rollbarData<{ items: RollbarApiItem[] }>(res)
        for (const raw of items) {
          const item = toItem(row.id, raw)
          out.push(item)
          pushed.add(item.identifier)
          await cacheItem(c, user.login, item, now)
        }
      } catch {
        // A failing connection degrades to its cache — minus whatever the fetch already pushed.
        out.push(...cached.filter((r) => !pushed.has(r.identifier)).map((r) => JSON.parse(r.data) as RollbarItem))
      }
    }
    out.sort((a, b) => (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0))
    return c.json({ items: out } satisfies RollbarItemsResponse)
  })
  // One item's detail (?integration=<id>) — the provider pane resolves task_links through this.
  .get('/items/:identifier', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const identifier = c.req.param('identifier')
    const integrationId = c.req.query('integration')
    if (!integrationId) return c.json({ error: 'bad_request' }, 400)
    const rows = await rollbarRows(c, user.login)
    const row = rows.find((r) => r.id === integrationId)
    if (!row) return c.json({ error: 'rollbar_not_connected' }, 403)
    const db = getDb(c.env)
    const now = Date.now()
    const cached = (
      await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.integrationId, integrationId), eq(schema.issues.identifier, identifier)))
    )[0]
    if (cached && cached.fetchedAt + ITEMS_STALE_AFTER_MS > now) return c.json(JSON.parse(cached.data) as RollbarItem)
    const token = await decryptSecret(row.accessToken, c.env.SESSION_ENC_KEY)
    if (!token) return c.json({ error: 'rollbar_not_connected' }, 403)
    try {
      const res = await rollbarFetch(token, itemByCounterPath(identifier))
      const raw = await rollbarData<RollbarApiItem>(res)
      const item = toItem(integrationId, raw)
      await cacheItem(c, user.login, item, now)
      return c.json(item)
    } catch {
      if (cached) return c.json(JSON.parse(cached.data) as RollbarItem) // stale beats nothing
      return c.json({ error: 'not_found' }, 404)
    }
  })
