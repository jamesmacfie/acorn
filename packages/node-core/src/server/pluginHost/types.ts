// The Node-side plugin interface. The host binds each plugin's route namespace and owns its
// registration/disposal records; cross-plugin behavior is resolved through typed capabilities,
// provider registries and contracts, and clients are told about change through broadcasts.
import type { Hono } from 'hono'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type { CoreServices } from '../core'
import type { PluginDatabase } from '../plugins/storage'
import type { ConnectionProviderContribution, IntegrationProviderContribution } from '../integrations/types'
import type { ModelProviderAdapter } from '../modelProviders/types'
import type { AgentToolContribution } from '../agentTools/registry'
import type { CollectionReadRegistration } from '../collections/registry'
import type { NodeActionRegistration } from '../nodeActions'
import type { NodeProviderContribution } from '../nodeProviders/registry'
import type { RunSourceRegistration } from '../runs/registry'
import type { Extension, ExtensionPointId } from './extensionPoints'
import type { PluginContextSection } from '../agentTools/contextSections'
import type { PluginHarnessRegistry } from './harnesses'
import type { TaskCheck } from './taskChecks'
import type { AppEnv, Principal } from '../middleware/auth'
import type { CapabilityRegistry, Disposable } from './capabilities'
import type { StreamHandlers, WsChannelHandler } from '../transport/wsHub'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import type { NodeEventChannel } from '@acorn/protocol/nodeEvents.ts'
import type { PluginEmit } from '@acorn/protocol/plugin/contract.ts'
import type { HookMode, HookPayload, HookPayloadShape, HookVerdict } from '@acorn/protocol/extensionPoints.ts'

// Another plugin's live channel, by shape. Validated at subscribe time against the producer's `emits`.
export type PluginEventChannel = `plugin:${string}:${string}`
import type { RouteResult } from '../sync/engine'
import type { StoredConnection } from '../integrations/connections'
import type { ExternalItemStore } from '../integrations/itemStore'

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

/**
 * A turn in one of this plugin's decisions, offered to other plugins (./hooks.ts, docs/plugins.md §
 * Hooks).
 *
 * The owner's half is `declare` plus `run`: declare the moment and what is allowed at it, then call
 * `run` at the moment and act on the verdict. The contributor's half is `handle`, which names somebody
 * else's point out loud.
 *
 * Declaring one is the whole lifecycle: the host mints the point id from this plugin, bounds every
 * handler, records failures on the roster row, and ties removal to teardown.
 */
export type PluginHookRegistry = {
  /** A point this plugin owns. `id` is qualified with this plugin, so a package cannot declare a point
   *  in a stranger's name any more than it can mount a route under one. */
  declare(point: PluginHookPoint): void
  /** A handler on a point, this plugin's or another's. `point` is the qualified `<owner>:<id>`. */
  handle(point: string, handler: PluginHookHandler): void
  /** Run one of this plugin's own points. `id` is the bare point id; the host qualifies it. Never
   *  rejects: every failure inside the chain resolves to a verdict (./hooks.ts). */
  run<T extends HookPayload>(id: string, payload: T): Promise<HookVerdict<T>>
}

export type PluginHookPoint = {
  /** Unique within this plugin, and the half of the public name a contributor writes down. */
  id: string
  /** What the owner is opening, in the owner's words. The trust prompt quotes it. */
  label: string
  /** The declared shape, in the tree's prop vocabulary. A transform's answer is checked against it. */
  payload: HookPayloadShape
  allows: readonly HookMode[]
  /** Per handler. Defaults to five seconds. */
  timeoutMs?: number
  /** Veto handlers only. `allow` unless the owner says otherwise, because a plugin that stalls must
   *  not brick whatever this hook guards. */
  onTimeout?: 'allow' | 'deny'
  order?: 'priority' | 'install'
  /** Run every veto rather than stopping at the first, so the owner can show all the reasons. */
  collect?: boolean
}

export type PluginHookHandler = {
  /** Unique within this plugin. The host qualifies it before it leaves. */
  id: string
  mode: HookMode
  priority?: number
  /** The answer the mode asks for: `{ payload }` for a transform, `{ ok, reason? }` for a veto,
   *  anything at all for an observer, whose answer is dropped unread. */
  run(payload: HookPayload, signal: AbortSignal): Promise<unknown>
}

// Where this plugin's collections can be read from the node, with no client attached
// (docs/future/cron/targets.md § seam 1). Not a second way to declare a collection: the client-side
// registration is what makes one appear in a panel editor, and this is the pointer that lets the
// measure sampler ask the same route the same question. A loaded plugin registers nothing here.
export type PluginCollectionRegistry = {
  register(collection: CollectionReadRegistration): void
}

// Where this plugin's runs can be read from the node (../runs/registry.ts). Not a second way to
// declare a run: the plugin keeps its own table, its own lifecycle and its own surfaces, and this is
// the pointer that lets the host list them beside another plugin's without either importing the other.
//
// Register one if your plugin owns work that starts, takes time, and ends. A plugin that owns no such
// thing registers nothing, which is the right answer for most.
export type PluginRunRegistry = {
  register(source: RunSourceRegistration): void
}

// Work this plugin will do when something asks: a name, a route inside its own namespace, and how
// dangerous it is (../nodeActions/registry.ts). Not a way to declare an action — it is the pointer
// plus the risk tier — and not a schedule seam, though a user schedule is the one thing asking today
// (docs/schedules.md § Targets). Registering nothing means nothing outside this plugin can make it
// act, which is the right default for most.
export type PluginNodeActionRegistry = {
  register(action: NodeActionRegistration): void
}

// The node's many-to-many seam between plugins (./extensionPoints.ts). A plugin opens a point in its
// own namespace and any number of plugins deliver entries into it, ordered, each disposed with the
// plugin that filed it. Capabilities are the single-provider seam beside this one; reach for a
// capability when there is one right answer and for a point when there are many.
export type PluginExtensionPointRegistry = {
  // Declare a point this plugin hosts. The id must start with this plugin's own name.
  open<T>(point: ExtensionPointId<T>, label: string): void
  // Deliver one entry into a point, this plugin's own or another's. The host mints the entry id from
  // the plugin, so two packages can use the same entry name without colliding.
  contribute<T>(point: ExtensionPointId<T>, entry: { id: string; order?: number; value: T }): void
  // What is in a point right now, in declared order. Resolve at call time: the plugin that fills your
  // point may init after you do.
  entries<T>(point: ExtensionPointId<T>): Extension<T>[]
}

// What this plugin puts on the node's audit trail (docs/security.md § Audit). Both tiers: a loaded
// plugin declares `auditActions` in its manifest and the host replays those declarations through
// `declare` here, exactly as it does for schedules and task checks.
//
// The host qualifies every verb with the plugin id and refuses a `record` naming one this plugin did
// not declare, so the trail stays enumerable: the settings surface can name every verb it might draw
// because each one came from a parsed manifest.
export type PluginAuditRegistry = {
  declare(action: { id: string; label: string }): void
  // Fire-and-forget, like core's own writes: an audit row is evidence, and a failed insert must never
  // fail the thing it describes. `details` takes allowlisted scalars decided at the call site — never a
  // request body, a credential, or a file's contents.
  record(action: string, entry?: { subject?: string | null; details?: Record<string, string | number | boolean | null> }): void
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
  // A provider that knows about nodes, and optionally can make and remove them
  // (../nodeProviders/registry.ts, docs/plugins.md § Node providers). Host-qualified id, disposal on
  // unload, and `create` obliging `destroy`, validated at registration.
  //
  // Read the contract before writing one: a node provider runs on some node, not necessarily the one
  // the person is sitting at, with no client necessarily attached.
  nodes(provider: NodeProviderContribution): void
  // Node-side work such as an agent tool has no HTTP request context, but may still need the
  // credential of a provider this plugin owns. The host lends the first usable connection for one
  // callback and keeps decryption/redaction inside the same scoped runtime used by routes.
  withConnection<T>(
    userId: string,
    providerId: string,
    visit: PluginProviderConnectionVisitor<T>,
  ): Promise<T | undefined>
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
  // "This repo's committed config changed and needs the owner's review". The one notice that carries an
  // action, because ignoring it silently disables a repo's scripts.
  repoConfigTrustNotice(taskId: string): void
  // Hear a core event on this node, whether or not a client is attached
  // (docs/plugins.md § Hearing another plugin). `event` must be one of NODE_EVENT_CHANNELS, and for
  // a loaded plugin it must also be in its manifest's `permissions.events`. The frame is a hint: the
  // contract is "go re-read", not a payload schema.
  //
  // The send side is `send` above and it is not symmetric with this on purpose. A plugin announces on
  // its own namespace and hears core's and, through the producer's `emits` declaration, another
  // plugin's.
  //
  // Since 2026-08-28 `event` may also be another plugin's `plugin:<id>:<verb>`, when that plugin
  // declared the verb in its `emits` and, for a loaded subscriber, the channel is in its own
  // `permissions.events`. An absent producer delivers nothing and errors nothing
  // (docs/plugins.md § Hearing another plugin).
  on(event: NodeEventChannel | PluginEventChannel, listener: (frame: WsServerFrame) => void): Disposable
  // Claim a WS channel prefix, the token before the first ':' in a channel name. The client mirror is
  // registerWsChannel (@acorn/client-core/infra/node/wsChannels.ts). Disposal is the host's.
  channel(prefix: string, handler: WsChannelHandler): void
  // The PTY stream handlers: input, attach and detach, plus the task-scope check the hub applies before
  // it lets a socket drive a stream. Exactly one plugin may own these.
  streams(handlers: StreamHandlers): void
}

// The registry as plugins may use it. Structural rather than the class itself, because a loaded plugin
// receives a filtered wrapper (server/plugins/permissions.ts).
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
// surface. server/pluginHost/host.ts builds both shapes, and server/plugins/permissions.ts explains why the
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
  // Both tiers. A loaded plugin declares `taskChecks` in its manifest and the host synthesises the
  // registration through this seam.
  taskChecks: PluginTaskCheckRegistry
  contextSections: PluginContextSectionRegistry
  // Both tiers. A route pointer, so a loaded plugin needs nothing more than the route it already has.
  runs: PluginRunRegistry
  // Both tiers, same two feeders as schedules and task checks.
  audit: PluginAuditRegistry
  extensionPoints: PluginExtensionPointRegistry
  // Both tiers, both halves. A loaded plugin declares its points and handlers in its manifest and the
  // host synthesises the registrations through this seam; a built-in calls `declare` and `handle`
  // directly. `run` is the owner's side and is bound to this plugin's own points.
  hooks: PluginHookRegistry
  providers: PluginProviderRegistry
  capabilities: PluginCapabilities
  // Present for a loaded plugin, and for a built-in that declared `migrationsModule`. A plugin that owns
  // no tables never receives this projection, so reaching for it is an immediate "not a function".
  storage: PluginStorage
  // Path confinement, git, the process broker and use-scoped secrets (server/core/). A plugin consumes
  // core capability through this rather than deep-importing whichever core module has the helper.
  core: CoreServices
  // Tell connected clients something changed. See PluginBroadcast above for why this isn't an event bus.
  events: PluginBroadcast
}

// The two seams the host fills in on a plugin's behalf, kept off the authoring type above.
//
// Neither is something a plugin writes. A manifest declares node actions (as commands whose verb is
// `runNodeAction`) and harnesses, and server/pluginHost/host.ts replays those declarations through here.
// Sitting on `NodePluginContext` they read as members an author should reach for, and in 21 plugins
// nobody ever did. `harnesses` is not even a registry: it is a handover to whichever plugin owns agent
// sessions (./harnesses.ts).
export type HostPluginContext = NodePluginContext & {
  nodeActions: PluginNodeActionRegistry
  harnesses: PluginHarnessRegistry
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
  // The compiled tier's `emits` (docs/plugins.md § Hearing another plugin): which of this plugin's
  // `plugin:<id>:<verb>` verbs another plugin may subscribe to, with a sentence each for the settings
  // page. A loaded plugin declares the same thing in its manifest and this field is ignored for it.
  emits?: readonly PluginEmit[]
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
