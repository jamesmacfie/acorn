import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { auth } from './routes/auth'
import { me } from './routes/me'
import { prActions } from './routes/prActions'
import { prefs } from './routes/prefs'
import { pullDetail } from './routes/pullDetail'
import { pullFiles } from './routes/pullFiles'
import { pulls } from './routes/pulls'
import { repos } from './routes/repos'

// One Worker, both /auth and /api. Non-matching paths never reach here — run_worker_first
// in wrangler.jsonc routes only /api/* and /auth/* to the Worker; the SPA serves the rest.
const app = new Hono<AppEnv>()
  .route('/auth', auth)
  .use('/api/*', csrf()) // Origin / Sec-Fetch-Site check on mutating calls
  .use('/api/*', authMiddleware) // stateless cookie → ctx.user (stub for now)
  .route('/api/me', me)
  .route('/api/prefs', prefs)
  .route('/api/repos', repos)
  .route('/api/repos', pulls) // repo-scoped sub-resources, e.g. /:owner/:repo/pulls
  .route('/api/repos', pullDetail) // /:owner/:repo/pulls/:number
  .route('/api/repos', pullFiles) // /:owner/:repo/pulls/:number/files
  .route('/api/repos', prActions) // PR write actions: merge / close / reopen / draft / comments

// The RPC contract consumed by the SPA's typed hono/client. See docs/api-structure.md.
export type AppType = typeof app

export default app
