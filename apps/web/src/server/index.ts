import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { auth } from './routes/auth'
import { me } from './routes/me'

// One Worker, both /auth and /api. Non-matching paths never reach here — run_worker_first
// in wrangler.jsonc routes only /api/* and /auth/* to the Worker; the SPA serves the rest.
const app = new Hono<AppEnv>()
  .route('/auth', auth)
  .use('/api/*', csrf()) // Origin / Sec-Fetch-Site check on mutating calls
  .use('/api/*', authMiddleware) // stateless cookie → ctx.user (stub for now)
  .route('/api/me', me)

// The RPC contract consumed by the SPA's typed hono/client. See docs/api-structure.md.
export type AppType = typeof app

export default app
