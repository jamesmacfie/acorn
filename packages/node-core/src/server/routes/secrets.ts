import { Hono } from 'hono'
import type { OnePasswordStatus } from '@acorn/protocol/api.ts'
import { forgetResolved, probe } from '../core/onePassword'
import type { AppEnv } from '../middleware/auth'

// Settings → Security → 1Password. Two questions the page cannot answer on its own: is the `op` CLI
// runnable on this node, and please forget what you cached.
//
// The switch itself and the cache lifetime are preferences, so they go through /prefs like every
// other preference. Only these two need the node to do something.
export const secrets = new Hono<AppEnv>()
  .get('/onepassword', async (c) => c.json(await probe() satisfies OnePasswordStatus))
  .post('/onepassword/refresh', (c) => {
    forgetResolved()
    // A body rather than 204, so the client's one JSON write path does not need a special case for
    // the only route that answers with nothing.
    return c.json({ ok: true })
  })
