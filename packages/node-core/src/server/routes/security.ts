import { Hono } from 'hono'
import type { NodeSecurityPosture } from '@acorn/protocol/api.ts'
import { diskEncryption } from '../../main/diskEncryption'
import type { AppEnv } from '../middleware/auth'

// What this node can tell the owner about its own posture (docs/security.md § On-disk).
//
// One field today, and deliberately only one. Two others were considered and dropped because reporting
// them would be decoration rather than information: the data root's mode is always 0700 (dataRoot.ts
// creates it that way and nothing changes it), and the bind host is always 127.0.0.1 (main/server.ts
// hard-codes it — there is no non-loopback setting yet, which is also why security.md's "non-loopback
// bind changes" has no audit producer). A settings page that lists constants teaches the reader to stop
// reading it.
//
// Gated to `requireDevice` at the mount in server/index.ts, with the same reasoning as the audit trail
// beside it: it describes the machine's security posture, which is reconnaissance for anything running
// in a task.
export const security = new Hono<AppEnv>().get('/', async (c) =>
  c.json({ diskEncrypted: await diskEncryption(), platform: process.platform } satisfies NodeSecurityPosture),
)
