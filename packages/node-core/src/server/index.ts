import { Hono } from 'hono'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { buildIntegrationProviderRoutes } from './integrations/providerRoutes'
import { idempotency } from './middleware/idempotency'
import { requireDevice, requireUser } from './middleware/requireUser'
import { onServerError, requestIdMiddleware } from './respond'
import { CORE_NAMESPACE, PLUGIN_NAMESPACE, pluginRouteContributions, routeMountPath } from './routeRegistry'
import { integrations } from './routes/integrations'
import { pairingRoutes } from './routes/pairing'
import { pins } from './routes/pins'
import { prefs } from './routes/prefs'
import { harness } from './routes/harness'
import { agentTools, agentToolsCatalog } from './routes/agentTools'
import { taskContext } from './routes/taskContext'
import { workspaces } from './routes/workspaces'
import { tasks } from './routes/tasks'
import { configTrust } from './routes/configTrust'
import { worktree } from './routes/worktree'

// One server, one namespace: /v2. createApp() is a factory so the bootstrap can build a fresh instance.
// Core mounts only core routers by name, under /v2/core; every plugin-owned router arrives through the
// route registry (populated by app/server/routes.ts before this runs) and mounts under /v2/p/<plugin> —
// core imports no product route module directly (docs/plugins.md).
export function createApp() {
  // Per-instance state (the pairing rate ceiling), so it must be built here rather than imported as a
  // module-level router.
  const pairing = pairingRoutes()

  // Mount order is the auth invariant: every /v2/* request passes authMiddleware (resolve principal) →
  // requireUser (enforce it) before any router. A router mounted before requireUser would be an
  // unauthenticated hole, so all /v2 routers stay below this line. One glob covers both namespaces,
  // which is why plugin prefixes are forced to be relative to /v2/p (routeRegistry.ts). See
  // docs/security.md §3.
  //
  // The one deliberate exception is `pairing.open` (GET /v2/node + POST /v2/pair): a client that has
  // never paired holds no credential, so those two ARE the way in (docs/vNext/protocol.md § Pairing).
  // They still sit under authMiddleware — they are public, not unprotected — and everything that
  // administers devices stays under /v2/core, below requireUser.
  //
  // There is NO csrf(), and its absence is deliberate rather than an omission. CSRF exists to defend
  // *ambient* credentials: a browser attaches a cookie to a cross-site request whether or not the page
  // meant to send it, so the server has to ask "did a page I trust initiate this?". This app has no
  // ambient credential left. Every request carries a bearer that lives in Electron main's connection
  // broker, and nothing a cross-site page can do makes anything attach it — the renderer holds no token
  // and, under app://acorn's CSP (`connect-src 'self'`), cannot open a socket to a node at all
  // (docs/vNext/security.md). The check used to be mounted on /auth only, for the one cookie-backed
  // mutation (POST /auth/logout); that route and its cookie are gone. Reinstating it over /v2 would
  // additionally break correct callers, because hono/csrf treats a *missing* content-type as
  // form-submittable and 403s any bodyless mutation — `DELETE /v2/core/devices/:id`, for one.
  const app = new Hono<AppEnv>()
    // First, unconditionally: every response — success, error, public or authenticated — carries a
    // request id, so a user-reported failure is findable in the log.
    .use('*', requestIdMiddleware)
    .use('/v2/*', authMiddleware) // resolve ctx.principal from a device bearer or the internal token
    .route('/v2', pairing.open) // GET /v2/node + POST /v2/pair — pre-auth by construction (see above)
    .use('/v2/*', requireUser) // single 401 gate over the protected router table
    // Below the gate on purpose: replay is keyed on the caller's deviceId, which only exists once the
    // principal is resolved and enforced (docs/vNext/protocol.md § HTTP conventions).
    .use('/v2/*', idempotency)
    // Device-only, not merely authenticated: these mint credentials and administer devices, which
    // docs/vNext/security.md forbids an internal (agent-spawned) caller from touching. requireUser
    // accepts either kind by design, so the narrower gate has to be explicit and has to sit here,
    // before the router — an agent that reaches pair/start can read the code out of the response and
    // mint itself an owner-authority token.
    .use(`${CORE_NAMESPACE}/pair`, requireDevice)
    .use(`${CORE_NAMESPACE}/pair/*`, requireDevice)
    .use(`${CORE_NAMESPACE}/devices`, requireDevice)
    .use(`${CORE_NAMESPACE}/devices/*`, requireDevice)
    .route(CORE_NAMESPACE, pairing.core) // /pair, /pair/start, /devices — owner-only device administration
    .route(`${CORE_NAMESPACE}/pins`, pins)
    .route(`${CORE_NAMESPACE}/prefs`, prefs)
    .route(`${CORE_NAMESPACE}/workspaces`, workspaces)
    .route(`${CORE_NAMESPACE}/tasks`, tasks)
    .route(`${CORE_NAMESPACE}/tasks`, configTrust)
    // Worktree/repo-config/task-lifecycle authority, moved out of the terminal plugin in Phase 2's
    // scope-shed. Mounted at the core root because it owns /task-statuses and /repos/path* as well as
    // /tasks/:id/* (server/routes/worktree.ts).
    .route(CORE_NAMESPACE, worktree)
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
  // authMiddleware/requireUser envelope). See app/server/routes.ts for the contributions.
  for (const contribution of pluginRouteContributions()) app.route(routeMountPath(contribution), contribution.router)

  return app.onError(onServerError) // uncaught throws still speak the ApiError envelope (docs/vNext/protocol.md § Errors)
}
