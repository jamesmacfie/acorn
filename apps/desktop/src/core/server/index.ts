import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { buildIntegrationProviderRoutes } from './integrations/providerRoutes'
import { requireUser } from './middleware/requireUser'
import { onServerError } from './respond'
import { pluginRouteContributions } from './routeRegistry'
import { auth } from './routes/auth'
import { integrations } from './routes/integrations'
import { me } from './routes/me'
import { pins } from './routes/pins'
import { prefs } from './routes/prefs'
import { harness } from './routes/harness'
import { agentTools, agentToolsCatalog } from './routes/agentTools'
import { taskContext } from './routes/taskContext'
import { workspaces } from './routes/workspaces'
import { tasks } from './routes/tasks'
import { configTrust } from './routes/configTrust'

// One server, both /auth and /api. The Node/Electron bootstrap (core/main/server.ts) wraps this with
// static asset serving + SPA fallback. createApp() is a factory so the bootstrap can build a fresh
// instance. Core mounts only core routers by name; every plugin-owned router arrives through the
// route registry (populated by app/server/routes.ts before this runs) — core imports no product
// route module directly (docs/plugins.md).
export function createApp() {
  // Mount order is the auth invariant: /auth is public (it establishes the session), then every
  // /api/* request passes csrf → authMiddleware (resolve principal) → requireUser (enforce it)
  // before any router. A router mounted before requireUser would be an unauthenticated hole, so
  // all /api routers stay below this line. See docs/security.md §3.
  const app = new Hono<AppEnv>()
    .route('/auth', auth)
    .use('/api/*', csrf()) // Origin / Sec-Fetch-Site check on mutating calls
    .use('/api/*', authMiddleware) // resolve ctx.principal from cookie or internal token
    .use('/api/*', requireUser) // single 401 gate over the protected router table
    .route('/api/me', me)
    .route('/api/pins', pins)
    .route('/api/prefs', prefs)
    .route('/api/workspaces', workspaces)
    .route('/api/tasks', tasks)
    .route('/api/tasks', configTrust)
    .route('/api/tasks', taskContext) // /:id/context — the assembled task context (docs/agent-tools.md §4)
    .route('/api/tasks', harness) // /:id/run — the renderer's run-target surface (docs/workflows.md §2)
    .route('/api/tasks', agentTools) // /:id/tools + /:id/tools/:name — the agent-tool registry projection (docs/agent-tools.md)
    .route('/api/agent-tools', agentToolsCatalog) // static tool catalog for the permissions settings page
    .route('/api/integrations', integrations) // connect/disconnect/status for third-party providers
    .route('/api', buildIntegrationProviderRoutes()) // provider-owned routes projected from the integration registry

  // Plugin-owned routers, projected from the registry AFTER the auth gate above (still inside the
  // csrf/authMiddleware/requireUser envelope). See app/server/routes.ts for the contributions.
  for (const { prefix, router } of pluginRouteContributions()) app.route(prefix, router)

  return app.onError(onServerError) // uncaught throws still speak ApiError on /api (docs/api-reference.md §error-codes)
}
