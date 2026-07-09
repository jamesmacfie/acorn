import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'

// App-state preferences (theme, diff view mode, …). Source of truth is us, not GitHub —
// user-scoped, no mirror/TTL. GET returns a key→value map; PUT upserts one key.
export const prefs = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = getUser(c)
    const rows = await getDb(c.env).select().from(schema.prefs).where(eq(schema.prefs.userId, user.login))
    return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
  })
  .put('/', async (c) => {
    const user = getUser(c)
    const { key, value } = (await c.req.json().catch(() => ({}))) as { key?: string; value?: string }
    if (!key || typeof value !== 'string') return respondError(c, 400, 'bad_request')
    await getDb(c.env)
      .insert(schema.prefs)
      .values({ userId: user.login, key, value })
      .onConflictDoUpdate({ target: [schema.prefs.userId, schema.prefs.key], set: { value } })
    return c.json({ key, value })
  })
