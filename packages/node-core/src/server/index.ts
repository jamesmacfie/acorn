import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { buildIntegrationProviderRoutes } from './integrations/providerRoutes'
import { requireUser } from './middleware/requireUser'
import { onServerError, requestIdMiddleware } from './respond'
import { CORE_NAMESPACE, PLUGIN_NAMESPACE, pluginRouteContributions, routeMountPath } from './routeRegistry'
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

// One server, both /auth and /v2. The Node/Electron bootstrap (core/main/server.ts) wraps this with
// static asset serving + SPA fallback. createApp() is a factory so the bootstrap can build a fresh
// instance. Core mounts only core routers by name, under /v2/core; every plugin-owned router arrives
// through the route registry (populated by app/server/routes.ts before this runs) and mounts under
// /v2/p/<plugin> — core imports no product route module directly (docs/plugins.md).
export function createApp() {
  // Mount order is the auth invariant: /auth is public (it establishes the session), then every
  // /v2/* request passes csrf → authMiddleware (resolve principal) → requireUser (enforce it)
  // before any router. A router mounted before requireUser would be an unauthenticated hole, so
  // all /v2 routers stay below this line. One glob covers both namespaces, which is why plugin
  // prefixes are forced to be relative to /v2/p (routeRegistry.ts). See docs/security.md §3.
  const app = new Hono<AppEnv>()
    // First, unconditionally: every response — success, error, public or authenticated — carries a
    // request id, so a user-reported failure is findable in the log.
    .use('*', requestIdMiddleware)
    // /auth is public, but its one mutating route (POST /logout) still needs the Origin check —
    // without it any page the user visits can force-log-them-out. Registered before the router
    // because Hono runs handlers in registration order.
    .use('/auth/*', csrf())
    .route('/auth', auth)
    .use('/v2/*', csrf()) // Origin / Sec-Fetch-Site check on mutating calls
    .use('/v2/*', authMiddleware) // resolve ctx.principal from cookie or internal token
    .use('/v2/*', requireUser) // single 401 gate over the protected router table
    .route(`${CORE_NAMESPACE}/me`, me)
    .route(`${CORE_NAMESPACE}/pins`, pins)
    .route(`${CORE_NAMESPACE}/prefs`, prefs)
    .route(`${CORE_NAMESPACE}/workspaces`, workspaces)
    .route(`${CORE_NAMESPACE}/tasks`, tasks)
    .route(`${CORE_NAMESPACE}/tasks`, configTrust)
    .route(`${CORE_NAMESPACE}/tasks`, taskContext) // /:id/context — the assembled task context (docs/agent-tools.md §4)
    .route(`${CORE_NAMESPACE}/tasks`, harness) // /:id/run — the renderer's run-target surface (docs/workflows.md §2)
    .route(`${CORE_NAMESPACE}/tasks`, agentTools) // /:id/tools + /:id/tools/:name — the agent-tool registry projection (docs/agent-tools.md)
    .route(`${CORE_NAMESPACE}/agent-tools`, agentToolsCatalog) // static tool catalog for the permissions settings page
    .route(`${CORE_NAMESPACE}/integrations`, integrations) // connect/disconnect/status for third-party providers
    // Provider-owned routes projected from the integration registry. Mounted at the plugin namespace
    // root, not a core one: the projection already prefixes each router with its provider id, which
    // IS the plugin id for the integration plugins (server/integrations/providerRoutes.ts).
    .route(PLUGIN_NAMESPACE, buildIntegrationProviderRoutes())

  // Plugin-owned routers, projected from the registry AFTER the auth gate above (still inside the
  // csrf/authMiddleware/requireUser envelope). See app/server/routes.ts for the contributions.
  for (const contribution of pluginRouteContributions()) app.route(routeMountPath(contribution), contribution.router)

  return app.onError(onServerError) // uncaught throws still speak the ApiError envelope (docs/vNext/protocol.md § Errors)
}
