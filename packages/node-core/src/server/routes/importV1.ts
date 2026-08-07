import { Hono } from 'hono'
import { z } from 'zod'
import { auditRequest } from '../auditRequest'
import { getDb } from '../db'
import { defaultV1Root, importV1Config, probeV1Root } from '../../main/v1Import'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

const runBody = z.strictObject({ path: z.string().min(1).max(4096).optional() })

export const importV1 = new Hono<AppEnv>()
  // `path` is a query parameter so the onboarding panel can ask about the default without knowing it —
  // only the node knows its own home directory.
  .get('/', (c) => c.json(probeV1Root(c.req.query('path') ?? defaultV1Root())))
  .post('/', async (c) => {
    const parsed = runBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const dir = parsed.data.path ?? defaultV1Root()
    if (!dir) return respondError(c, 400, 'bad_request', ['No V1 data root to import from.'])
    try {
      const report = await importV1Config(getDb(c.env), dir)
      auditRequest(c, {
        action: 'import.v1',
        subject: dir,
        // Counts, not contents. Enough for an owner to recognise the import in the trail and see how
        // much it moved; nothing that duplicates what the tables now hold.
        details: {
          workspaces: report.workspacesCreated,
          repos: report.reposRegrouped,
          checkouts: report.checkoutsImported,
        },
      })
      return c.json(report)
    } catch (error) {
      // A missing or unreadable root is caller input to correct, so it answers as a bad request rather
      // than an opaque 500.
      return respondError(c, 400, 'bad_request', [error instanceof Error ? error.message : String(error)])
    }
  })
