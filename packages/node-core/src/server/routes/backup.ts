import { Hono } from 'hono'
import { z } from 'zod'
import { auditRequest } from '../auditRequest'
import { createBackup, suggestBackupPath } from '../../main/backup'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

const body = z.strictObject({ destPath: z.string().min(1).max(4096) })

export const backup = new Hono<AppEnv>()
  .get('/', (c) => c.json({ suggestedPath: suggestBackupPath() }))
  .post('/', async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    try {
      const result = await createBackup(c.env.DATA_DIR, parsed.data.destPath)
      // Audited after it succeeds, and the path is part of the record: "where did my data go" is the
      auditRequest(c, { action: 'backup.created', subject: result.path, details: { bytes: result.bytes } })
      return c.json(result)
    } catch (error) {
      // A bad path, a full disk, a missing tar. All of them are the caller's problem to see rather than a
      // 500 with a request id, because every one of them is fixable by the person who asked.
      return respondError(c, 400, 'bad_request', [error instanceof Error ? error.message : String(error)])
    }
  })
