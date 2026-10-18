import { Hono } from 'hono'
import { NODE_KEEP_AWAKE } from '@acorn/protocol/api.ts'
import type { AppEnv } from '../middleware/auth'

// Whether this Node keeps its computer awake, for its row in Settings → Nodes
// (docs/node-distribution/keep-awake.md). Gated with requireDevice by mount in server/index.ts. The
// setting itself is an ordinary preference, written through PUT /v1/core/prefs.
export const nodePower = new Hono<AppEnv>().get('/power', async (c) =>
  c.json(await c.env.CAPABILITIES.require(NODE_KEEP_AWAKE).status()),
)
