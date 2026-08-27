import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { respondError } from '../respond'

// A preference row is one key and one string. `value` is a string even when the client is storing
// JSON, because the column is a string and the reader parses it; a schema that accepted `unknown`
// here would put an object into a text column.
const prefBody = z.object({ key: z.string().min(1), value: z.string() })

// App-state preferences (theme, diff view mode, …). Source of truth is us, not GitHub.
// user-scoped, no mirror/TTL. GET returns a key→value map; PUT upserts one key.
export const prefs = new Hono<AppEnv>()
  .get('/', async (c) => {
    const uid = ownerId(c)
    const rows = await getDb(c.env).select().from(schema.prefs).where(eq(schema.prefs.userId, uid))
    return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
  })
  .put('/', async (c) => {
    const uid = ownerId(c)
    const parsed = prefBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const { key, value } = parsed.data
    await getDb(c.env)
      .insert(schema.prefs)
      .values({ userId: uid, key, value })
      .onConflictDoUpdate({ target: [schema.prefs.userId, schema.prefs.key], set: { value } })
    return c.json({ key, value })
  })
