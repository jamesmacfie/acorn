import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { nodeStorageReport } from '../storage/footprint'

// Settings > Storage and memory: this node's memory and the size of what it keeps on disk
// (docs/data-layer.md § What the node reports). Device-only, mounted with `requireDevice` in
// server/index.ts, for the reason the security posture is: it describes the machine, not a task.
export const storage = new Hono<AppEnv>().get('/', async (c) => c.json(await nodeStorageReport(c.env.DATA_DIR)))
