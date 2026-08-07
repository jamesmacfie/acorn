import { Hono } from 'hono'
import { z } from 'zod'
import { auditRequest } from '../auditRequest'
import { createBackup, suggestBackupPath } from '../../main/backup'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// `POST /v2/core/backup` (docs/vNext/data.md § Backup).
//
// The destination is a path on the NODE's filesystem, not an upload — which is why the client shows a
// text field prefilled by the GET below rather than a native save dialog. Streaming a
// multi-gigabyte archive back through the broker to write it on the client's disk would be a different
// feature with different failure modes, and data.md asks for "a single archive in a user-chosen
// location", which for a build box means a location on the build box.
//
// Device-only at the mount in server/index.ts: it reads every database this node owns, and an
// agent-spawned child writing one to a path of its choosing is an exfiltration primitive even with the
// credentials scrubbed out.
const body = z.strictObject({ destPath: z.string().min(1).max(4096) })

export const backup = new Hono<AppEnv>()
  // Where the node suggests writing it. This exists so the client needs no native save dialog: a text
  // field prefilled with a real path on the RIGHT machine works for a remote node too, and a save dialog
  // would only ever have worked for the local one — it picks a path in the client's filesystem, which is
  // the wrong filesystem for exactly the deployment the fleet exists to serve.
  //
  // ponytail: no native dialog. Add one for the local node if someone asks for it.
  .get('/', (c) => c.json({ suggestedPath: suggestBackupPath() }))
  .post('/', async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    try {
      const result = await createBackup(c.env.DATA_DIR, parsed.data.destPath)
      // Audited AFTER it succeeds, and the path is part of the record: "where did my data go" is the
      // question this row exists to answer, and a failed attempt wrote nothing to answer it about.
      auditRequest(c, { action: 'backup.created', subject: result.path, details: { bytes: result.bytes } })
      return c.json(result)
    } catch (error) {
      // A bad path, a full disk, a missing tar. All of them are the caller's problem to see rather than a
      // 500 with a request id, because every one of them is fixable by the person who asked.
      return respondError(c, 400, 'bad_request', [error instanceof Error ? error.message : String(error)])
    }
  })
