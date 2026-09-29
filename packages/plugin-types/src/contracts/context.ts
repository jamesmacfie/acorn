import type { PluginRequestContext, PluginRouteRegistry } from './routes.js'
import type { PluginScheduleRegistry } from './schedules.js'
import type { PluginTaskCheckRegistry } from './taskChecks.js'
import type { PluginProviderRegistry } from './providers.js'
import type { PluginCapabilities } from './capabilities.js'
import type { PluginRunRegistry } from './runs.js'
import type { PluginAuditRegistry } from './audit.js'
import type { PluginExtensionPointRegistry } from './extensionPoints.js'
import type { PluginHookRegistry } from './hooks.js'
import type { PluginStorage } from './storage.js'
import type { PluginBroadcast } from './events.js'
import type { CoreServices } from './coreServices.js'
import type { Logger, PluginTelemetry } from './telemetry.js'
import type { DataSourceCatalog, DataSourceDiscoveryPage, DataSourceDiscoveryRequest, DataSourceRegistration, DataSourceRequest, DataSourceResponse, DataSourceScope, QueryBindingContext, QueryConsumer, QueryPublicationRequest, QueryPublicationResult, QueryReference, QueryScope, ResolvedQuery } from './data.js'

// ── The two entry points ──────────────────────────────────────────────────────────────────────────

/** The default export of a loaded plugin's node entrypoint. `name` must equal the manifest's `id`. */
export type NodePlugin = {
  name: string
  init(ctx: NodePluginContext): void | Promise<void>
  /** A second pass, after every plugin's `init`, for anything that has to read another plugin's
   *  contributions. Use it instead of depending on load order. */
  ready?(ctx: NodePluginContext): void | Promise<void>
  dispose?(): void | Promise<void>
}

/** Everything the host hands a loaded plugin, and nothing it does not.
 *
 * This is the loaded tier's projection. A compiled plugin's context has six more members —
 * `routes.register`, `tools`, `contextSections`, `events.channel` and
 * `events.streams` — each either a live object that cannot survive a message-passing boundary or a
 * live object that cannot survive the message-passing boundary. Agent tools and context sections
 * have manifest descriptor types above; they deliberately do not become live `ctx` registries.
 *
 * The host's own declaration of this type is
 * `packages/node-core/src/server/pluginHost/types.ts § NodePluginContext`, and a test holds the two
 * equal member for member, so this file cannot quietly fall behind.
 *
 * A facet under `core` is present only if the manifest asked for it. Reaching for one it did not
 * declare is an immediate "not a function", which is the intended failure. */
export type NodePluginContext<Conn = unknown, Items = unknown> = {
  readonly name: string
  routes: PluginRouteRegistry<Conn, Items>
  schedules: PluginScheduleRegistry
  dataSources: {
    register(source: DataSourceRegistration): void
    discover(discovery: { discoveryId: string; handler: string; providerId?: string }): void
    list(scope: DataSourceScope, invocation: { principal: PluginRequestContext['principal']; signal: AbortSignal }): Promise<DataSourceCatalog>
    discoverAvailable(request: DataSourceDiscoveryRequest, invocation: { principal: PluginRequestContext['principal']; signal: AbortSignal }): Promise<DataSourceDiscoveryPage>
    invoke<R extends DataSourceRequest>(request: R, invocation: { principal: PluginRequestContext['principal']; signal: AbortSignal }): Promise<DataSourceResponse<R>>
    resolveQuery(scope: QueryScope, reference: QueryReference, context: QueryBindingContext, invocation: { principal: PluginRequestContext['principal']; signal: AbortSignal }): Promise<ResolvedQuery>
    setQueryConsumer(scope: QueryScope, queryId: string, consumer: Omit<QueryConsumer, 'pluginId'>, invocation: { principal: PluginRequestContext['principal']; signal: AbortSignal }, remove?: boolean): Promise<void>
    queryPublication(request: QueryPublicationRequest, invocation: { principal: PluginRequestContext['principal']; signal: AbortSignal }): Promise<QueryPublicationResult>
  }
  taskChecks: PluginTaskCheckRegistry
  runs: PluginRunRegistry
  audit: PluginAuditRegistry
  extensionPoints: PluginExtensionPointRegistry
  hooks: PluginHookRegistry
  providers: PluginProviderRegistry
  capabilities: PluginCapabilities
  storage: PluginStorage
  core: CoreServices
  events: PluginBroadcast
  telemetry: PluginTelemetry
  log: Logger
}
