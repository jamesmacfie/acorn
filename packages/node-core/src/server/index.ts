import { Hono } from 'hono'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { buildIntegrationProviderRoutes } from './integrations/providerRoutes'
import { idempotency } from './middleware/idempotency'
import { requireDevice, requireProviderAccess, requireTaskScope, requireUser } from './middleware/requireUser'
import { onServerError, requestIdMiddleware } from './respond'
import { CORE_NAMESPACE, PLUGIN_NAMESPACE, pluginRouteContributions, routeMountPath } from './routeRegistry'
import { audit } from './routes/security/audit'
import { runs } from './routes/runs'
import { backup } from './routes/security/backup'
import { security } from './routes/security/security'
import { attachment } from './routes/attachment'
import { nodeProviderRoutes } from './routes/nodeProviders'
import { integrations } from './routes/integrations'
import { secrets } from './routes/secrets'
import { models } from './routes/models'
import { pairingRoutes } from './routes/pairing'
import { prefs } from './routes/prefs'
import { plugins } from './routes/plugins/plugins'
import { dashboards } from './routes/dashboards'
import { schedules } from './routes/schedules'
import { telemetry } from './routes/telemetry'
import { harness } from './routes/plugins/harness'
import { agentTools, agentToolsCatalog } from './routes/plugins/agentTools'
import { taskContext } from './routes/projects/taskContext'
import { projects } from './routes/projects/projects'
import { workspaces } from './routes/projects/workspaces'
import { tasks } from './routes/projects/tasks'
import { configTrust } from './routes/security/configTrust'
import { worktree } from './routes/projects/worktree'
import { dispatchPluginFetch } from './pluginHost/fetchRoute'

// One server, one namespace: /v2. createApp() is a factory so the bootstrap can build a fresh instance.
// Core mounts only core routers by name, under /v2/core. Every plugin-owned router arrives through the
// route registry, populated by app/server/routes.ts before this runs, and mounts under /v2/p/<plugin>.
// Core imports no product route module directly (docs/plugins.md).
export function createApp() {
  // Per-instance state (the pairing rate ceiling), so it must be built here rather than imported as a
  // module-level router.
  const pairing = pairingRoutes()

  const app = new Hono<AppEnv>()
    // First, unconditionally. Every response carries a request id, so a user-reported failure is
    // findable in the log.
    .use('*', requestIdMiddleware)
    .use('/v2/*', authMiddleware) // resolve ctx.principal from a device bearer or the internal token
    .route('/v2', pairing.open) // GET /v2/node + POST /v2/pair, pre-auth by construction
    .use('/v2/*', requireUser) // single 401 gate over the protected router table
    // Below the gate: replay is keyed on the caller's deviceId, which only exists once the
    // principal is resolved (docs/api-reference.md § Request processing).
    .use('/v2/*', idempotency)
    // Device-only: mints credentials and administers devices (docs/security.md § Transport and auth).
    // Must sit here, before the router, or a route added under this prefix is reachable ungated.
    .use(`${CORE_NAMESPACE}/pair`, requireDevice)
    .use(`${CORE_NAMESPACE}/pair/*`, requireDevice)
    .use(`${CORE_NAMESPACE}/devices`, requireDevice)
    .use(`${CORE_NAMESPACE}/devices/*`, requireDevice)
    // Node administration, same class as devices. Which plugins this node runs decides which routes
    // exist and which SQLite files open. A task-scoped agent must not read the list, which enumerates
    // the surface, or write it, which lets it disable the plugin whose gate it stands behind.
    .use(`${CORE_NAMESPACE}/plugins`, requireDevice)
    // Both forms, like `pair` and `devices` above (docs/security.md § Transport and auth), and the
    // pattern every gate below repeats. Under the Hono this repo pins, a trailing `/*` does also match
    // the bare path, so the second line is the load-bearing one and the first is belt. Whether that
    // holds has moved between Hono versions; writing both makes the gate independent of it, and
    // server/mountCoverage.test.ts reads the mount table the strict way so a single-form mount is
    // reported rather than trusted.
    .use(`${CORE_NAMESPACE}/plugins/*`, requireDevice)
    // The audit trail, same class again: it names every device that has paired and every credential
    // connected to this node, the enumeration security.md forbids an agent-spawned child.
    .use(`${CORE_NAMESPACE}/audit`, requireDevice)
    .use(`${CORE_NAMESPACE}/audit/*`, requireDevice)
    // The node's own security posture, same class again: it describes the machine, which is
    // reconnaissance for anything running in a task.
    .use(`${CORE_NAMESPACE}/security`, requireDevice)
    .use(`${CORE_NAMESPACE}/security/*`, requireDevice)
    // The attachment record, same class again: it names a control plane and the device row that
    // vouches for it, and the delete revokes that credential (docs/node-enrollment.md).
    .use(`${CORE_NAMESPACE}/attachment`, requireDevice)
    .use(`${CORE_NAMESPACE}/attachment/*`, requireDevice)
    // Node providers. The sharpest of this group: the list enumerates the owner's infrastructure,
    // `adopt` hands over a durable credential for another machine, and `create` spends money. None of
    // it is a question a task-scoped agent has any business asking (docs/plugins.md § Node providers).
    .use(`${CORE_NAMESPACE}/nodes`, requireDevice)
    .use(`${CORE_NAMESPACE}/nodes/*`, requireDevice)
    // Schedules, same class again: a schedule is code this node runs unattended, so creating one buys
    // persistence and pausing one silences the node's own housekeeping.
    .use(`${CORE_NAMESPACE}/schedules`, requireDevice)
    .use(`${CORE_NAMESPACE}/schedules/*`, requireDevice)
    // Backup reads every database this node owns and writes them to a path of the caller's choosing.
    // Even with the credentials scrubbed out, that is an exfiltration primitive in an agent's hands.
    .use(`${CORE_NAMESPACE}/backup`, requireDevice)
    .use(`${CORE_NAMESPACE}/backup/*`, requireDevice)
    // Preferences, same class again, and the sharpest of the three below. The agent-tool permission
    // ceiling is a preference key, so a task-scoped token that could write here would raise its own
    // ceiling and then call the tool it had just granted itself. Only the settings UI writes these,
    // always on a device principal; the node's own in-process PrefService.write does not pass here.
    .use(`${CORE_NAMESPACE}/prefs`, requireDevice)
    .use(`${CORE_NAMESPACE}/prefs/*`, requireDevice)
    // A project row holds setupScript, devScript, devRestartScript, teardownScript and dbUrlScript,
    // which this node executes on the next task. Writing one is arbitrary code execution with a
    // delay on it, so it is an owner act. An agent tool that needs to read its own project's
    // configuration gets a task-addressed route under /tasks/:id, never a widening of this gate.
    .use(`${CORE_NAMESPACE}/projects`, requireDevice)
    .use(`${CORE_NAMESPACE}/projects/*`, requireDevice)
    // Workspaces are the top-level unit the owner organises by hand, and none of these routes is
    // task-addressed, so nothing narrows a delete to the caller's own work.
    .use(`${CORE_NAMESPACE}/workspaces`, requireDevice)
    .use(`${CORE_NAMESPACE}/workspaces/*`, requireDevice)
    // Task scope, enforced by mount rather than per handler (docs/security.md § Transport and auth).
    .use(`${CORE_NAMESPACE}/tasks/:id`, requireTaskScope)
    .use(`${CORE_NAMESPACE}/tasks/:id/*`, requireTaskScope)
    .use(`${PLUGIN_NAMESPACE}/:plugin/tasks/:id`, requireTaskScope)
    .use(`${PLUGIN_NAMESPACE}/:plugin/tasks/:id/*`, requireTaskScope)
    // Administering or spending the owner's provider connections: device principals plus the node's own
    // service-scope calls (docs/security.md § Credential handling), never a task-scoped child.
    .use(`${CORE_NAMESPACE}/integrations`, requireProviderAccess)
    .use(`${CORE_NAMESPACE}/integrations/*`, requireProviderAccess)
    // Where this node reads credentials from, and clearing what it cached. Same gate as the
    // connections themselves: it describes the owner's credential setup.
    .use(`${CORE_NAMESPACE}/secrets`, requireProviderAccess)
    .use(`${CORE_NAMESPACE}/secrets/*`, requireProviderAccess)
    // Which model backends the owner holds, and which agent CLI is installed here. Device-only: it is a
    // roster of what this machine can spend, and no task-scoped child has any use for it.
    .use(`${CORE_NAMESPACE}/models`, requireDevice)
    .use(`${CORE_NAMESPACE}/models/*`, requireDevice)
    // Telemetry another runtime collected. Device-only for a different reason from the rest of this
    // group: it is a write, not a read. Everything admitted here reaches every subscribed sink, and a
    // sink can post it off the machine, so a task-scoped agent must not be able to put words in one
    // (docs/telemetry.md § Other runtimes).
    .use(`${CORE_NAMESPACE}/telemetry`, requireDevice)
    .use(`${CORE_NAMESPACE}/telemetry/*`, requireDevice)
    .route(CORE_NAMESPACE, pairing.core) // /pair, /pair/start, /devices: owner-only device administration
    .route(`${CORE_NAMESPACE}/prefs`, prefs)
    .route(`${CORE_NAMESPACE}/secrets`, secrets) // Settings → Security: whether the 1Password CLI is runnable here
    .route(`${CORE_NAMESPACE}/dashboards`, dashboards) // /history: the measure series a stat's trend is drawn from
    .route(`${CORE_NAMESPACE}/plugins`, plugins) // Settings → Plugins: the roster + the per-node toggle
    .route(`${CORE_NAMESPACE}/audit`, audit) // Settings → Security: the append-only trail (security.md § Audit)
    .route(`${CORE_NAMESPACE}/security`, security) // Settings → Security: this node's posture (security.md § On-disk)
    .route(`${CORE_NAMESPACE}/attachment`, attachment) // Settings → Nodes: the control plane this node is attached to (docs/node-enrollment.md)
    .route(`${CORE_NAMESPACE}/nodes`, nodeProviderRoutes) // plugin-provided nodes and their lifecycle (docs/plugins.md § Node providers)
    .route(`${CORE_NAMESPACE}/schedules`, schedules) // Settings → Schedules: periodic work owned by the node (docs/schedules.md)
    .route(`${CORE_NAMESPACE}/runs`, runs) // Settings → Runs: every plugin's runs, merged (@acorn/protocol/runs.ts)
    .route(`${CORE_NAMESPACE}/backup`, backup) // docs/data-layer.md § Backup: core + plugin databases, minus credentials
    .route(`${CORE_NAMESPACE}/projects`, projects)
    .route(`${CORE_NAMESPACE}/workspaces`, workspaces)
    .route(`${CORE_NAMESPACE}/tasks`, tasks)
    .route(`${CORE_NAMESPACE}/tasks`, configTrust)
    .route(CORE_NAMESPACE, worktree)
    .route(`${CORE_NAMESPACE}/tasks`, taskContext) // /:id/context: the assembled task context (docs/agent-tools.md §4)
    .route(`${CORE_NAMESPACE}/tasks`, harness) // /:id/run: the renderer's run-target surface (docs/workflows.md §2)
    .route(`${CORE_NAMESPACE}/tasks`, agentTools) // /:id/tools + /:id/tools/:name: the agent-tool registry projection (docs/agent-tools.md)
    .route(`${CORE_NAMESPACE}/agent-tools`, agentToolsCatalog) // static tool catalog for the permissions settings page
    .route(`${CORE_NAMESPACE}/integrations`, integrations) // connect/disconnect/status for third-party providers
    .route(`${CORE_NAMESPACE}/models`, models) // /backends: the connections and installed CLIs a Generate control can spend
    .route(`${CORE_NAMESPACE}/telemetry`, telemetry) // the batch route every other runtime posts to (docs/telemetry.md)
    // Provider-owned routes projected from the integration registry. Mounted at the plugin namespace
    // root rather than a core one, because the projection already prefixes each router with its
    // provider id (server/integrations/providerRoutes.ts).
    //
    // The provider-credential gate lives inside that projection, not as a `/v2/p/:provider/*` mount
    // here. Such a mount matches every plugin route, and Hono applies `.use()` by path regardless of
    // registration order, so it would lock task-scoped agents out of surfaces they legitimately use.
    .route(PLUGIN_NAMESPACE, buildIntegrationProviderRoutes())

  // Plugin-owned routes, projected from the registry after the auth gate above and still inside the
  // authMiddleware/requireUser envelope. See app/server/routes.ts for the contributions.
  //
  // Built-ins only. A Hono instance is a live object, so mounting it is the only thing to do with it,
  // and a built-in is compiled into this binary and cannot change without a restart.
  for (const contribution of pluginRouteContributions()) {
    if (contribution.router) app.route(routeMountPath(contribution), contribution.router)
  }

  // Fetch-shaped contributions from loaded plugins are dispatched, not mounted. One handler pair over
  // the whole plugin namespace, resolving the contribution per request, because a reload replaces a
  // plugin's registry entries while this mount table stays as it was built (routeRegistry.ts
  // § resolvePluginFetch). Two mounts because Hono's `/*` does not match the bare path itself, and a
  // plugin owning its whole namespace has to answer `/v2/p/<id>`.
  //
  // Registered last, falling through with next() when nothing matches, so a built-in's router and the
  // provider routes answer first and an unclaimed path reaches the app's own 404.
  app.all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
  app.all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)

  return app.onError(onServerError) // uncaught throws still speak the ApiError envelope (docs/api-reference.md § Errors)
}
