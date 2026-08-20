// The Node-side plugin interface. The host binds each plugin's route namespace and owns its
// registration/disposal records; cross-plugin behavior is resolved through typed capabilities,
// provider registries and contracts, and clients are told about change through broadcasts.
import type { Hono } from 'hono'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type { CoreServices } from '../../main/core'
import type { PluginDatabase } from '../../main/pluginStorage'
import type { ConnectionProviderContribution, IntegrationProviderContribution } from '../integrations/types'
import type { ModelProviderAdapter } from '../modelProviders/types'
import type { AgentToolContribution } from '../agentTools/registry'
import type { CollectionReadRegistration } from '../collections/registry'
import type { NodeActionRegistration } from '../nodeActions/registry'
import type { PluginContextSection } from '../agentTools/contextSections'
import type { TaskCheck } from './taskChecks'
import type { AppEnv, Principal } from '../middleware/auth'
import type { CapabilityRegistry } from './capabilities'
import type { StreamHandlers, WsChannelHandler } from '../../main/wsHub'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import type { RouteResult } from '../sync/engine'
import type { StoredConnection } from '../integrations/connections'
import type { ExternalItemStore } from '../integrations/itemStore'

// Prefixed console, so a plugin's warnings are attributable without every call site restating its own
// name. No levels, transports or structured fields.
export type PluginLogger = Pick<Console, 'log' | 'warn' | 'error'>

export type PluginRouteOptions = {
  // Path inside this plugin's namespace: '' for a router owning the whole namespace, '/tasks' for
  // task-scoped sub-resources. The effective mount is /v2/p/<plugin><prefix>.
  prefix?: string
  note?: string
}

// What a fetch-shaped route handler learns about the caller. The identity projection is plain data, and
// provider operations are async RPC over plain data. `withConnections` is the deliberate callback
// exception: the host lends one decrypted credential for the duration of a provider-owned operation
// without exposing its database or secret service.
export type PluginRequestContext = {
  // Already authenticated by the host's middleware. `userId` is the stable owner projection most
  // handlers need; `principal` is for callers that must tell an interactive device from an internal
  // service or task.
  readonly userId: string
  readonly principal: Principal
  // Bound to this request, owner and plugin. Core database and secret-service handles stay behind these
  // calls.
  readonly providers: PluginProviderRuntime
}

export type PluginProviderResourceRequest<TInput> = {
  providerId: string
  connectionId: string
  resourceId: string
  input: TInput
  force?: boolean
}

export type PluginProviderConnectionVisitor<T> = (
  connection: StoredConnection,
  secret: string,
) => Promise<T | undefined>

export type PluginProviderRuntime = {
  resource<TInput, TOutput>(args: PluginProviderResourceRequest<TInput>): Promise<RouteResult<TOutput>>
  connections(providerId: string): Promise<StoredConnection[]>
  withConnections<T>(providerId: string, visit: PluginProviderConnectionVisitor<T>): Promise<T[]>
  // The provider's slice of core's external-item cache, and the route-side twin of `ownedExternalItems`.
  //
  // A route needs it for the shape `resource()` can't express: resolution that spans connections. A
  // bare `ENG-42` hasn't been attributed to a Linear workspace yet, so its cached row has to be read
  // across every connection before there's a connectionId to key a resource call on.
  //
  // The host checks the plugin owns `providerId` at the ask, and the store it returns is built for that
  // provider. One live-object exception: it returns a store synchronously rather than plain data, so it
  // needs a proxy before loaded plugins can move out of process.
  items(providerId: string): ExternalItemStore
}

// The route shape a loaded plugin serves. A Hono instance can't cross a process boundary; a
// (Request) → Response function can. A plugin can still build its routes with its own bundled Hono and
// hand over `app.fetch`.
export type PluginFetchHandler = (request: Request, context: PluginRequestContext) => Response | Promise<Response>

export type PluginRouteRegistry = {
  // The plugin id is bound by the host, so a plugin can't mount itself under another's namespace, which
  // a raw registerRoute({ plugin }) call could do by typo or intent.
  //
  // Built-ins only: this hands the host a live object from the plugin's realm. Absent from a loaded
  // plugin's context.
  register(router: Hono<AppEnv>, options?: PluginRouteOptions): void
  // The portable half. Same mount, same auth gate. The handler receives a Request whose path is
  // relative to that mount, exactly as `register` gives a router paths relative to its own.
  fetch(handler: PluginFetchHandler, options?: PluginRouteOptions): void
}

export type PluginToolRegistry = {
  // Agent-tool contributions live with the engine they drive. The host binds the plugin owner and
  // projects the registry to HTTP, MCP and renderer permission surfaces.
  register(tool: AgentToolContribution): void
}

// Periodic work the node runs for this plugin (docs/schedules.md). Node-side, because a client closes,
// hides and sleeps, and a schedule is a promise to run when nobody is looking.
//
// Declaring one is the whole lifecycle: the host mints the key, ties removal to teardown, and keeps the
// state row across a disable and re-enable. Any `setInterval` in plugin node code is a review flag.
export type PluginScheduleRegistry = {
  register(schedule: PluginSchedule): void
}

export type PluginSchedule = {
  // Unique within this plugin. The host prefixes it, so a plugin can't file a schedule under a
  // stranger's name any more than it can mount a route under one.
  scheduleId: string
  // What the settings list and the trust dialog call it.
  name: string
  // Clamped on read to the plugin floor (300s for an interval), which the key prefix selects.
  cadence: Cadence
  // Seconds, capped at 300: the manifest descriptor's unit, not the engine's milliseconds. Absent means
  // the engine default of 60s.
  timeout?: number
  // The declared default. The owner's pause/resume overrides it and outlives a reload.
  enabled?: boolean
  // Timeout and node shutdown both arrive as the signal. The return value is ignored beyond a one-line
  // detail for the run row; report failure by throwing.
  run(signal: AbortSignal): Promise<string | void>
}

// What this plugin has to say when the owner archives a task, and the cleanup it can offer
// (./taskChecks.ts). See docs/plugins.md § Task checks. Declaring one is the whole lifecycle: the host
// binds the owner, qualifies every concern id, bounds the call and ties removal to teardown.
export type PluginTaskCheckRegistry = {
  register(check: TaskCheck): void
}

// Where this plugin's collections can be read from the node, with no client attached
// (docs/future/cron/targets.md § seam 1). Not a second way to declare a collection: the client-side
// registration is what makes one appear in a panel editor, and this is the pointer that lets the
// measure sampler ask the same route the same question. A loaded plugin registers nothing here.
export type PluginCollectionRegistry = {
  register(collection: CollectionReadRegistration): void
}

// Which of this plugin's chrome actions a user may put on a schedule (docs/schedules.md § Targets).
// Not a way to declare an action: this is the pointer plus the risk tier. Registering nothing means
// none of this plugin's actions can be scheduled, which is the right default for most.
export type PluginNodeActionRegistry = {
  register(action: NodeActionRegistration): void
}

export type PluginContextSectionRegistry = {
  // A plugin contributes one task-context section. Core owns assembly, ordering, budgets and output
  // format; the section gets no core database handle and declares only its own data source.
  register(section: PluginContextSection): void
}

// Connection, integration and model-provider descriptors are registered by the plugin that owns them.
// The host validates provider ids and projects provider routes under the provider namespace.
export type PluginProviderRegistry = {
  // `route` is a built-in Hono router or a portable fetch handler, mounted at /v2/p/<provider.id>
  // through buildIntegrationProviderRoutes(). Both stay behind `requireProviderAccess`; loaded plugins
  // must use the fetch carrier.
  integration(provider: IntegrationProviderContribution, route?: Hono<AppEnv> | PluginFetchHandler): void
  // A provider that owns credentials but contributes no mirrored resources (the model providers).
  connection(provider: ConnectionProviderContribution): void
  // A text-generation adapter for an already-registered connection provider. Register the connection
  // first; the registry refuses an adapter naming an unknown one.
  model(adapter: ModelProviderAdapter): void
}

// The client-notification surface, and the only one there is.
//
// A broadcast is an invalidation channel, not an event log: no durability, no replay, no delivery
// guarantee, and a client that misses one refetches after the gap. That's load-bearing
// (docs/architecture-overview.md). Deliberately not plugin-to-plugin: two plugins that need to talk use
// a capability.
export type PluginBroadcast = {
  // Push a frame to every connected client. The hub skips task-confined sockets.
  send(frame: WsServerFrame): void
  // The content-free ping. The renderer re-pulls what it's showing rather than trusting a payload.
  status(): void
  // The renderer's notification bell (docs/workflows.md). The memory-proposal gate reuses it.
  notice(taskId: string, kind: 'gate' | 'run-done', title: string): void
  // "This repo's committed config changed and needs the owner's review". The one notice that carries an
  // action, because ignoring it silently disables a repo's scripts.
  repoConfigTrustNotice(taskId: string): void
  stepEvent(runId: string, stepId: string, event: unknown): void
  // Claim a WS channel prefix, the token before the first ':' in a channel name. The client mirror is
  // registerWsChannel (@acorn/client-core/wsChannels.ts). Disposal is the host's.
  channel(prefix: string, handler: WsChannelHandler): void
  // The PTY stream handlers: input, attach and detach, plus the task-scope check the hub applies before
  // it lets a socket drive a stream. Exactly one plugin may own these.
  streams(handlers: StreamHandlers): void
}

// The registry as plugins may use it. Structural rather than the class itself, because a loaded plugin
// receives a filtered wrapper (main/pluginPermissions.ts).
export type PluginCapabilities = Pick<CapabilityRegistry, 'provide' | 'get' | 'require' | 'ids'>

// Host-bound storage, for both tiers. The host binds the database filename to the plugin id, applies the
// Drizzle chain, hands back one handle per boot however many times open() is called, and closes it after
// that plugin's dispose. Only the chain's origin differs between the tiers.
// See docs/data-layer.md § Plugin DBs.
export type PluginStorage = {
  open(): PluginDatabase
}

// The two plugin tiers get different runtime projections of this common authoring type. Loaded plugins
// omit undeclared core facets plus the first-party route and event members; built-ins get the full
// surface. server/plugin/host.ts builds both shapes, and main/pluginPermissions.ts explains why the
// type doesn't describe every omission.
export type NodePluginContext = {
  readonly name: string
  routes: PluginRouteRegistry
  tools: PluginToolRegistry
  // Both tiers. A loaded plugin normally declares its schedules in its manifest, which is what puts them
  // in front of the owner at install, and the host registers those through this same seam.
  schedules: PluginScheduleRegistry
  // Both tiers, same as schedules: a loaded plugin's entries are synthesised from its manifest, and
  // nothing downstream can tell which feeder answered.
  collections: PluginCollectionRegistry
  // Both tiers. Empty for most plugins: an action is listed here only when its author means "a person
  // may reasonably want this to happen on a timer".
  nodeActions: PluginNodeActionRegistry
  // Both tiers. A loaded plugin declares `taskChecks` in its manifest and the host synthesises the
  // registration through this seam.
  taskChecks: PluginTaskCheckRegistry
  contextSections: PluginContextSectionRegistry
  providers: PluginProviderRegistry
  capabilities: PluginCapabilities
  // Present for a loaded plugin, and for a built-in that declared `migrationsModule`. A plugin that owns
  // no tables never receives this projection, so reaching for it is an immediate "not a function".
  storage: PluginStorage
  // Path confinement, git, the process broker and use-scoped secrets (main/core/). A plugin consumes
  // core capability through this rather than deep-importing whichever core module has the helper.
  core: CoreServices
  // Tell connected clients something changed. See PluginBroadcast above for why this isn't an event bus.
  events: PluginBroadcast
  log: PluginLogger
}

export type NodePlugin = {
  name: string
  // agents, memory, notes and terminal: core, or the shell in front of it, assumes their contributions
  // exist, so they can't be disabled. GitHub owns an optional provider surface and importer.
  required?: boolean
  // "I own tables, and here's where my Drizzle chain lives", as this module's own `import.meta.url`,
  // because the chain sits beside the plugin in all three runtime layouts. Declaring it turns
  // `ctx.storage` on.
  //
  // Ignored for a plugin loaded from disk, whatever its bundle sets: its chain is the
  // manifest-declared, package-confined one the loader resolved.
  migrationsModule?: string
  // Awaited before the listener binds. Init may open plugin storage, migrate rows, or prepare route
  // state that must be complete before requests are served.
  init(ctx: NodePluginContext): void | Promise<void>
  // A second pass, after every plugin's init and still before the listener binds. Use it only for work
  // that needs another plugin's contribution; init order is not a dependency contract.
  ready?(ctx: NodePluginContext): void | Promise<void>
  // Release what the plugin opened: timers, children, pools, slots. Not its database. The host awaits
  // this and then closes the `ctx.storage` handle, so an in-flight write still has a live connection.
  dispose?(): void | Promise<void>
}
