import { Hono } from 'hono'
import { z } from 'zod'
import { readAudit } from '../audit'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'

// The owner-readable audit trail (docs/vNext/security.md § Audit: "Owner-readable in Settings").
//
// Read-only, and there is deliberately no delete: an append-only table with a 90-day prune is the whole
// design, and a route that could remove rows would make the trail worth less than the prune already
// makes it. Retention is enforced at boot (server/audit.ts's pruneAudit).
//
// Gated to `requireDevice` at the MOUNT in server/index.ts, alongside pair/devices/plugins. It has to
// be: the trail names every device that has ever paired and every credential that has been connected,
// which is precisely the enumeration security.md forbids an agent-spawned child.
const query = z.object({
  // A timestamp cursor, not an offset. Rows are only appended and pruned from the far end, so an
  // offset would skip or repeat entries whenever a prune ran under a paging reader.
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const audit = new Hono<AppEnv>().get('/', async (c) => {
  // Invalid paging params fall back to the defaults rather than 400: this is a read of a log, and a
  // stale bookmark in the settings UI should show the first page, not an error.
  const parsed = query.safeParse(c.req.query())
  const entries = await readAudit(getDb(c.env), parsed.success ? parsed.data : {})
  return c.json({
    entries,
    // The cursor for the next page, or null at the end. Computed here so the client never has to know
    // that the cursor is a timestamp — it can stay an opaque token if paging ever changes shape.
    nextBefore: entries.length > 0 ? entries[entries.length - 1].at : null,
  })
})
