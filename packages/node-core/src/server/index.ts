import { Hono } from 'hono'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { buildIntegrationProviderRoutes } from './integrations/providerRoutes'
import { idempotency } from './middleware/idempotency'
import { requireDevice, requireProviderAccess, requireTaskScope, requireUser } from './middleware/requireUser'
import { onServerError, requestIdMiddleware } from './respond'
import { CORE_NAMESPACE, PLUGIN_NAMESPACE, pluginRouteContributions, routeMountPath } from './routeRegistry'
import { audit } from './routes/audit'
import { backup } from './routes/backup'
import { security } from './routes/security'
import { integrations } from './routes/integrations'
import { pairingRoutes } from './routes/pairing'
import { prefs } from './routes/prefs'
import { plugins } from './routes/plugins'
import { dashboards } from './routes/dashboards'
import { schedules } from './routes/schedules'
import { harness } from './routes/harness'
import { agentTools, agentToolsCatalog } from './routes/agentTools'
import { taskContext } from './routes/taskContext'
import { projects } from './routes/projects'
import { workspaces } from './routes/workspaces'
import { tasks } from './routes/tasks'
import { configTrust } from './routes/configTrust'
import { worktree } from './routes/worktree'
import { dispatchPluginFetch } from './plugin/fetchRoute'

// One server, one namespace: /v2. createApp() is a factory so the bootstrap can build a fresh instance.
// Core mounts only core routers by name, under /v2/core; every plugin-owned router arrives through the
// route registry (populated by app/server/routes.ts before this runs) and mounts under /v2/p/<plugin>.
// Core imports no product route module directly (docs/plugins.md).
export function createApp() {
  // Per-instance state (the pairing rate ceiling), so it must be built here rather than imported as a
  // module-level router.
  const pairing = pairingRoutes()

  const app = new Hono<AppEnv>()
    // First, unconditionally. Every response, success, error, public, or authenticated, carries a
    // request id, so a user-reported failure is findable in the log.
    .use('*', requestIdMiddleware)
    .use('/v2/*', authMiddleware) // resolve ctx.principal from a device bearer or the internal token
    .route('/v2', pairing.open) // GET /v2/node + POST /v2/pair — pre-auth by construction (see above)
    .use('/v2/*', requireUser) // single 401 gate over the protected router table
    // Below the gate: replay is keyed on the caller's deviceId, which only exists once the
    // principal is resolved (docs/api-reference.md § Request processing).
    .use('/v2/*', idempotency)
    // Device-only: mints credentials and administers devices (docs/security.md § Transport and auth).
    // Must sit here, before the router, or a route added under this prefix would be reachable
    // ungated.
    .use(`${CORE_NAMESPACE}/pair`, requireDevice)
    .use(`${CORE_NAMESPACE}/pair/*`, requireDevice)
    .use(`${CORE_NAMESPACE}/devices`, requireDevice)
    .use(`${CORE_NAMESPACE}/devices/*`, requireDevice)
    // Node administration, same class as devices: which plugins this node runs decides which routes
    // exist and which SQLite files open, so a task-scoped agent must not be able to read the list (it
    // enumerates the surface) or write it (it could disable the plugin whose gate it is standing behind
    // and get a different node on the next restart).
    .use(`${CORE_NAMESPACE}/plugins`, requireDevice)
    // Both forms, like `pair` and `devices` above (docs/security.md § Transport and auth: gating by
    // mount rather than per route). There is no subpath today, so this is insurance against a route
    // added later under a one-form mount. Hono's trailing `/*` does not match the bare path, which is
    // why both forms are needed everywhere this pattern repeats.
    .use(`${CORE_NAMESPACE}/plugins/*`, requireDevice)
    // The audit trail, same class again: it names every device that has ever paired and every credential
    // that has been connected to this node, which is exactly the enumeration security.md forbids an
    // agent-spawned child. Both path forms, like every sibling above.
    .use(`${CORE_NAMESPACE}/audit`, requireDevice)
    .use(`${CORE_NAMESPACE}/audit/*`, requireDevice)
    // The node's own security posture, same class again: it describes the machine, which is
    // reconnaissance for anything running in a task.
    .use(`${CORE_NAMESPACE}/security`, requireDevice)
    .use(`${CORE_NAMESPACE}/security/*`, requireDevice)
    // Schedules, same class again: a schedule is code this node runs unattended, so creating one is a
    // persistence primitive and pausing one can silence the node's own housekeeping. Both path forms,
    // like every sibling above.
    .use(`${CORE_NAMESPACE}/schedules`, requireDevice)
    .use(`${CORE_NAMESPACE}/schedules/*`, requireDevice)
    // Backup reads every database this node owns and writes them to a path of the caller's choosing.
    // Even with the credentials scrubbed out, that is an exfiltration primitive in an agent's hands.
    .use(`${CORE_NAMESPACE}/backup`, requireDevice)
    .use(`${CORE_NAMESPACE}/backup/*`, requireDevice)
    // Task scope, enforced by mount rather than per handler (docs/security.md § Transport and auth).
    .use(`${CORE_NAMESPACE}/tasks/:id`, requireTaskScope)
    .use(`${CORE_NAMESPACE}/tasks/:id/*`, requireTaskScope)
    .use(`${PLUGIN_NAMESPACE}/:plugin/tasks/:id`, requireTaskScope)
    .use(`${PLUGIN_NAMESPACE}/:plugin/tasks/:id/*`, requireTaskScope)
    // Administering or spending the owner's provider connections: device principals plus the node's own
    // service-scope calls (docs/security.md § Credential handling), never a task-scoped child.
    .use(`${CORE_NAMESPACE}/integrations`, requireProviderAccess)
    .use(`${CORE_NAMESPACE}/integrations/*`, requireProviderAccess)
    .route(CORE_NAMESPACE, pairing.core) // /pair, /pair/start, /devices — owner-only device administration
    .route(`${CORE_NAMESPACE}/prefs`, prefs)
    .route(`${CORE_NAMESPACE}/dashboards`, dashboards) // /history — the measure series a stat's trend is drawn from
    .route(`${CORE_NAMESPACE}/plugins`, plugins) // Settings → Plugins: the roster + the per-node toggle
    .route(`${CORE_NAMESPACE}/audit`, audit) // Settings → Security: the append-only trail (security.md § Audit)
    .route(`${CORE_NAMESPACE}/security`, security) // Settings → Security: this node's posture (security.md § On-disk)
    .route(`${CORE_NAMESPACE}/schedules`, schedules) // Settings → Schedules: periodic work owned by the node (docs/schedules.md)
    .route(`${CORE_NAMESPACE}/backup`, backup) // docs/data-layer.md § Backup: core + plugin databases, minus credentials
    .route(`${CORE_NAMESPACE}/projects`, projects)
    .route(`${CORE_NAMESPACE}/workspaces`, workspaces)
    .route(`${CORE_NAMESPACE}/tasks`, tasks)
    .route(`${CORE_NAMESPACE}/tasks`, configTrust)
    .route(CORE_NAMESPACE, worktree)
    .route(`${CORE_NAMESPACE}/tasks`, taskContext) // /:id/context — the assembled task context (docs/agent-tools.md §4)
    .route(`${CORE_NAMESPACE}/tasks`, harness) // /:id/run — the renderer's run-target surface (docs/workflows.md §2)
    .route(`${CORE_NAMESPACE}/tasks`, agentTools) // /:id/tools + /:id/tools/:name — the agent-tool registry projection (docs/agent-tools.md)
    .route(`${CORE_NAMESPACE}/agent-tools`, agentToolsCatalog) // static tool catalog for the permissions settings page
    .route(`${CORE_NAMESPACE}/integrations`, integrations) // connect/disconnect/status for third-party providers
    // Provider-owned routes projected from the integration registry. Mounted at the plugin namespace
    // root, not a core one: the projection already prefixes each router with its provider id, which is
    // the plugin id for the integration plugins (server/integrations/providerRoutes.ts).
    //
    // The provider-credential gate lives inside that projection, not as a `/v2/p/:provider/*` mount
    // here. Such a mount would match every plugin route (terminal's sessions, the editor's files), and
    // Hono applies `.use()` by path regardless of registration order, so it would have locked
    // task-scoped agents out of surfaces they legitimately use.
    .route(PLUGIN_NAMESPACE, buildIntegrationProviderRoutes())

  // Plugin-owned routes, projected from the registry after the auth gate above (still inside the
  // authMiddleware/requireUser envelope). See app/server/routes.ts for the contributions.
  //
  // Built-ins only: a Hono instance is a live object, so mounting it is the only thing to do with it, and
  // a built-in is compiled into this binary and cannot change without a restart.
  for (const contribution of pluginRouteContributions()) {
    if (contribution.router) app.route(routeMountPath(contribution), contribution.router)
  }

  // Fetch-shaped contributions (loaded plugins) are dispatched, not mounted. One handler pair over the
  // whole plugin namespace, resolving the current contribution per request, because a reload replaces a
  // plugin's registry entries while this mount table stays as it was built (routeRegistry.ts
  // § resolvePluginFetch). Two mounts because Hono's `/*` does not match the bare path itself, and a
  // plugin owning its whole namespace has to answer `/v2/p/<id>`.
  //
  // Registered last, falling through with next() when nothing matches: a built-in's router, and the
  // provider routes above, are earlier in the chain and answer first, and a path no plugin claims
  // reaches the app's own 404 exactly as it did before.
  app.all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
  app.all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)

  return app.onError(onServerError) // uncaught throws still speak the ApiError envelope (docs/api-reference.md § Errors)
}
