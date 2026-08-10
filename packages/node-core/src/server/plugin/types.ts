// The Node-side plugin interface. The host binds each plugin's route namespace and owns its
// registration/disposal records; cross-plugin behavior is resolved through typed capabilities,
// provider registries and contracts, and clients are told about change through broadcasts.
import type { Hono } from 'hono'
import type { CoreServices } from '../../main/core'
import type { PluginDatabase } from '../../main/pluginStorage'
import type { ConnectionProviderContribution, IntegrationProviderContribution } from '../integrations/types'
import type { ModelProviderAdapter } from '../modelProviders/types'
import type { AgentToolContribution } from '../agentTools/registry'
import type { PluginContextSection } from '../agentTools/contextSections'
import type { AppEnv, Principal } from '../middleware/auth'
import type { CapabilityRegistry } from './capabilities'
import type { StreamHandlers, WsChannelHandler } from '../../main/wsHub'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import type { RouteResult } from '../sync/engine'
import type { StoredConnection } from '../integrations/connections'
import type { ExternalItemStore } from '../integrations/itemStore'

// Prefixed console. A plugin's warnings should be attributable without every call site restating
// its own name; nothing here needs levels, transports or structured fields yet.
export type PluginLogger = Pick<Console, 'log' | 'warn' | 'error'>

export type PluginRouteOptions = {
  // Path INSIDE this plugin's namespace: '' for a router owning the whole namespace, '/tasks' for
  // task-scoped sub-resources. The effective mount is /v2/p/<plugin><prefix>.
  prefix?: string
  note?: string
}

// What a fetch-shaped route handler learns about the caller. The identity projection is plain data;
// provider operations are an async RPC-shaped capability whose arguments and results are plain data.
// `withConnections` is the deliberate callback exception: the host lends one decrypted credential
// for the duration of a provider-owned operation without exposing its database or secret service.
// `items` is the same idea for state rather than credentials: row-shaped calls against core's
// external-item cache, with the owner and the provider bound here rather than passed in.
export type PluginRequestContext = {
  // Already authenticated by the host's middleware before the handler is reached. `userId` is the
  // stable owner projection most handlers need; `principal` remains for callers that must distinguish
  // an interactive device from an internal service or task.
  readonly userId: string
  readonly principal: Principal
  // Bound to this request, owner, and plugin. Core database and secret-service handles stay behind
  // these calls and are never exposed to the plugin.
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
  // The provider's slice of core's external-item cache — the same store a mirrored RESOURCE already
  // receives on `ProviderResourceContext.items`, and the route-side twin of `ownedExternalItems`.
  //
  // A route needs it for the one shape `resource()` cannot express: resolution that spans connections.
  // A bare `ENG-42` has not been attributed to a Linear workspace yet, so its cached row has to be read
  // across every connection of the provider before there is a connectionId to key a resource call on.
  // Without this, a loaded provider's batch route has no local cache at all and calls the vendor on
  // every read — which is a latency and rate-limit regression, not a simplification.
  //
  // Rows in, rows out. The host checks the plugin owns `providerId` at the ask, and the store it
  // returns is built FOR that provider (integrations/itemStore.ts) — every query carries it, so the
  // check at the ask is the truth about every row the store can reach. A plugin's own resource
  // already writes these same rows; this widens what it can reach by nothing.
  //
  // One live-object exception: this returns a store synchronously rather than plain data over an
  // async call, so unlike the three methods above it needs a proxy before loaded plugins can move
  // out of process.
  items(providerId: string): ExternalItemStore
}

// The route shape a LOADED plugin serves. A Hono instance cannot cross a process boundary; a
// (Request) → Response function can, which is why this is the only door a loaded plugin gets. A
// plugin is still free to build its routes with its own bundled Hono and hand over `app.fetch`.
export type PluginFetchHandler = (request: Request, context: PluginRequestContext) => Response | Promise<Response>

export type PluginRouteRegistry = {
  // The plugin id is bound by the host, so a plugin cannot mount itself under another's namespace —
  // which the raw registerRoute({ plugin }) call could do by typo or by intent.
  //
  // Built-ins only: this hands the host a live object from the plugin's realm, which is exactly what
  // a process boundary cannot carry. Absent from a loaded plugin's context.
  register(router: Hono<AppEnv>, options?: PluginRouteOptions): void
  // The portable half. Mounted at the same /v2/p/<plugin><prefix>, behind the same auth gate; the
  // handler receives a Request whose path is relative to that mount, exactly as `register` gives a
  // router paths relative to its own mount.
  fetch(handler: PluginFetchHandler, options?: PluginRouteOptions): void
}

export type PluginToolRegistry = {
  // Agent-tool contributions live with the engine they drive. The host binds the plugin owner and
  // projects the registry to HTTP, MCP, and renderer permission surfaces.
  register(tool: AgentToolContribution): void
}

export type PluginContextSectionRegistry = {
  // A plugin contributes one task-context section. Core owns assembly, ordering, budgets, and output
  // format; the section receives no core database handle and declares only its own data source.
  register(section: PluginContextSection): void
}

// Connection, integration, and model-provider descriptors are registered by the plugin that owns
// them. The host validates provider IDs and projects provider routes under the provider namespace.
export type PluginProviderRegistry = {
  // `route` is either a built-in Hono router or a portable fetch handler, mounted at
  // /v2/p/<provider.id> through buildIntegrationProviderRoutes(). Both remain behind
  // `requireProviderAccess`; loaded plugins must use the fetch carrier.
  integration(provider: IntegrationProviderContribution, route?: Hono<AppEnv> | PluginFetchHandler): void
  // A provider that owns credentials but contributes no mirrored resources (the model providers).
  connection(provider: ConnectionProviderContribution): void
  // A text-generation adapter for an already-registered connection provider. Register the connection
  // first; the registry refuses an adapter naming an unknown provider.
  model(adapter: ModelProviderAdapter): void
}

// The client-notification surface, and the only one there is.
//
// docs/plugins.md used to list "event subscriptions" as a contribution point and the header of this
// file named events as a collaboration mechanism, but no emitter ever existed: what plugins actually
// did was deep-import main/wsHub.ts and main/notify.ts. Rather than build the bus the docs described,
// this blesses what is real and names it honestly. A broadcast is an INVALIDATION CHANNEL, not an
// event log — there is no durability, no replay, and no delivery guarantee, and a client that misses
// one refetches after the gap. That decision is load-bearing (docs/architecture-overview.md).
//
// It is deliberately not plugin-to-plugin. Two plugins that need to talk use a capability; this is for
// telling the renderer something changed.
export type PluginBroadcast = {
  // Push a frame to every connected client. Task-confined sockets are skipped by the hub.
  send(frame: WsServerFrame): void
  // The content-free ping. The renderer re-pulls whatever it is showing rather than trusting a payload.
  status(): void
  // The renderer's notification bell (docs/workflows.md). The memory-proposal gate reuses it.
  notice(taskId: string, kind: 'gate' | 'run-done', title: string): void
  // "This repo's committed config changed and needs the owner's review" — the one notice that carries
  // an action, because ignoring it silently disables a repo's scripts.
  repoConfigTrustNotice(taskId: string): void
  stepEvent(runId: string, stepId: string, event: unknown): void
  // Claim a WS channel prefix — the token before the first ':' in a channel name. The client mirror is
  // registerWsChannel (@acorn/client-core/wsChannels.ts). Disposal is the host's.
  channel(prefix: string, handler: WsChannelHandler): void
  // The PTY stream handlers: input/attach/detach plus the task-scope check the hub applies before it
  // lets a socket drive a stream. Exactly one plugin may own these.
  streams(handlers: StreamHandlers): void
}

// The registry as plugins may use it. Structural rather than the class itself, because a loaded
// plugin receives a filtered wrapper (main/pluginPermissions.ts) rather than the registry instance.
export type PluginCapabilities = Pick<CapabilityRegistry, 'provide' | 'get' | 'require' | 'ids'>

// Host-bound storage for a loaded plugin: its manifest chooses a confined migrations directory and
// the host binds the database filename to the manifest id. Built-ins retain their existing explicit
// openPluginDb calls because their migration chains are staged with the app.
export type PluginStorage = {
  open(): PluginDatabase
}

// The two plugin tiers receive different runtime projections of this common authoring type. Loaded
// plugins omit undeclared core facets plus the first-party route/event members, and receive storage
// bound from their manifest. Built-ins receive the full core/route/event surface and keep their
// compile-time database factories, so `storage` is absent. server/plugin/host.ts builds both shapes;
// main/pluginPermissions.ts explains why the type deliberately does not describe every omission.
export type NodePluginContext = {
  readonly name: string
  routes: PluginRouteRegistry
  tools: PluginToolRegistry
  contextSections: PluginContextSectionRegistry
  providers: PluginProviderRegistry
  capabilities: PluginCapabilities
  // Present for loaded plugins. A missing manifest `migrations` declaration fails loudly on open;
  // built-ins use their compile-time storage factories and do not receive this projection.
  storage: PluginStorage
  // Path confinement, git, the process broker and use-scoped secrets (main/core/). A plugin consumes
  // core capability through this, rather than deep-importing whichever core module has the helper.
  core: CoreServices
  // Tell connected clients something changed. See PluginBroadcast above for why this is not an event bus.
  events: PluginBroadcast
  log: PluginLogger
}

export type NodePlugin = {
  name: string
  // agents, memory, notes and terminal: core (or the shell in front of it) assumes their contributions
  // exist, so they cannot be disabled. GitHub owns an optional provider surface and importer.
  required?: boolean
  // Awaited before the listener binds. Initialization may open plugin storage, migrate rows, or prepare
  // route state that must be complete before requests can be served.
  init(ctx: NodePluginContext): void | Promise<void>
  // A second pass runs after every plugin's init and still before the listener binds. Use it only for
  // work that needs another plugin's contribution; initialization order is not a dependency contract.
  ready?(ctx: NodePluginContext): void | Promise<void>
  // Release resources opened by init(). The host awaits disposal before closing plugin databases and
  // releasing the data-root lock.
  dispose?(): void | Promise<void>
}
