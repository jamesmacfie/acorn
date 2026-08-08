// The Node-side plugin interface. The host binds each plugin's route namespace and owns its
// registration/disposal records; cross-plugin behavior is resolved through typed capabilities,
// provider registries and contracts, and clients are told about change through broadcasts.
import type { Hono } from 'hono'
import type { CoreServices } from '../../main/core'
import type { ConnectionProviderContribution, IntegrationProviderContribution } from '../integrations/types'
import type { ModelProviderAdapter } from '../modelProviders/types'
import type { AgentToolContribution } from '../agentTools/registry'
import type { PluginContextSection } from '../agentTools/contextSections'
import type { AppEnv } from '../middleware/auth'
import type { CapabilityRegistry } from './capabilities'
import type { StreamHandlers, WsChannelHandler } from '../../main/wsHub'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'

// Prefixed console. A plugin's warnings should be attributable without every call site restating
// its own name; nothing here needs levels, transports or structured fields yet.
export type PluginLogger = Pick<Console, 'log' | 'warn' | 'error'>

export type PluginRouteOptions = {
  // Path INSIDE this plugin's namespace: '' for a router owning the whole namespace, '/tasks' for
  // task-scoped sub-resources. The effective mount is /v2/p/<plugin><prefix>.
  prefix?: string
  note?: string
}

export type PluginRouteRegistry = {
  // The plugin id is bound by the host, so a plugin cannot mount itself under another's namespace —
  // which the raw registerRoute({ plugin }) call could do by typo or by intent.
  register(router: Hono<AppEnv>, options?: PluginRouteOptions): void
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
  // `route` is the provider's own router, mounted at /v2/p/<provider.id> through
  // buildIntegrationProviderRoutes(). It stays gated by `requireProviderAccess` inside that projection —
  // this seam changes who declares the provider, not who may reach it.
  integration(provider: IntegrationProviderContribution, route?: Hono<AppEnv>): void
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

export type NodePluginContext = {
  readonly name: string
  routes: PluginRouteRegistry
  tools: PluginToolRegistry
  contextSections: PluginContextSectionRegistry
  providers: PluginProviderRegistry
  capabilities: CapabilityRegistry
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
