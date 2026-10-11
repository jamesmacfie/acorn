import { Hono } from 'hono'
import type { NodeSecurityPosture } from '@acorn/protocol/api.ts'
import { diskEncryption } from '../../storage/diskEncryption'
import type { AppEnv } from '../../middleware/auth'

// What this node can tell the owner about its own posture (docs/security/audit.md § Filesystem and backup).
//
// The data root's mode is not reported: it is always 0700, because the data root is created that way
// and nothing changes it, so the field would be decoration rather than information.
export const security = new Hono<AppEnv>().get('/', async (c) =>
  c.json({ diskEncrypted: await diskEncryption(), platform: process.platform } satisfies NodeSecurityPosture),
)
