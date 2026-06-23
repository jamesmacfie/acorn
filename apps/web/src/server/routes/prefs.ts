import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'

// App-state preferences (theme, diff view mode, …). Source of truth is us, not GitHub —
// user-scoped, no mirror/TTL. GET returns a key→value map; PUT upserts one key.
export const prefs = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await getDb(c.env).select().from(schema.prefs).where(eq(schema.prefs.userId, user.login))
    return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
  })
  .put('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const { key, value } = (await c.req.json().catch(() => ({}))) as { key?: string; value?: string }
    if (!key || typeof value !== 'string') return c.json({ error: 'bad_request' }, 400)
    await getDb(c.env)
      .insert(schema.prefs)
      .values({ userId: user.login, key, value })
      .onConflictDoUpdate({ target: [schema.prefs.userId, schema.prefs.key], set: { value } })
    return c.json({ key, value })
  })
