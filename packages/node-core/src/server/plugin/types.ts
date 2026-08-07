// The Node-side plugin interface. The host binds each plugin's route namespace and owns its
// registration/disposal records; cross-plugin behavior is resolved through typed capabilities,
// provider registries, events, and contracts.
import type { Hono } from 'hono'
import type { CoreServices } from '../../main/core'
import type { ConnectionProviderContribution, IntegrationProviderContribution } from '../integrations/types'
import type { ModelProviderAdapter } from '../modelProviders/types'
import type { AgentToolContribution } from '../agentTools/registry'
import type { PluginContextSection } from '../agentTools/contextSections'
import type { AppEnv } from '../middleware/auth'
import type { CapabilityRegistry } from './capabilities'

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
  log: PluginLogger
}

export type NodePlugin = {
  name: string
  // github, terminal and agents: core assumes their capabilities exist, so they cannot be disabled.
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
