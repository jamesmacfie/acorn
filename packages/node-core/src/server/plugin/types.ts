// The node-side plugin interface (docs/vNext/plugins.md § The plugin API).
//
// A formalization, not an invention: every member below replaces a mechanism that already exists in
// apps/node/src/wiring/, where a plugin's server part was assembled by the APP rather than by the
// plugin. `routes` replaces `registerRoute({ plugin: 'github', … })`; `capabilities` and `events`
// replace direct `@acorn/plugin-X/main/…` imports; `init` replaces the eleven `wireX()` calls whose
// hand-ordered sequence in service/runtime.ts was load-bearing.
//
// Divergence from plugins.md worth knowing: the doc puts these in a `packages/plugin-api` package.
// Phase 0 shipped without one and every plugin already depends on @acorn/node-core, so a fourth
// package would add a manifest and nothing else. Recorded in docs/vNext/phase2-notes.md.
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
  // The agent-tool contribution point (docs/vNext/plugins.md § Agent tools and MCP). One tool at a
  // time, so a plugin's tools live with the engine they drive instead of in an app-layer file holding
  // every plugin's deps in one bag. The owner is bound by the host, like a route's plugin id.
  register(tool: AgentToolContribution): void
}

export type PluginContextSectionRegistry = {
  // One section of the assembled task context (docs/vNext/plan.md § Phase 3, item 3). Replaces core's
  // single `setContextSections(buildContextSections({ notes, memory, pullRequest }))` slot, which had to be
  // filled with every plugin's source at once and therefore forced the composition root to hold three
  // plugins' seams — the reason apps/node/src/wiring/contextSectionsWiring.ts existed at all.
  //
  // The section a plugin registers cannot reach core's database handle: see PluginContextSection. Core keeps
  // the budget/legacy/format contract, so a plugin declares where its rows come from and nothing about how
  // the block is rendered. Owner-bound by the host, like routes and tools.
  register(section: PluginContextSection): void
}

// Connection / integration / model providers, contributed by the plugin that implements them
// (docs/vNext/plugins.md § Cross-plugin collaboration). This is what let apps/node/src/server/providers.ts
// be deleted: a provider used to be registered by a side-effect import in the composition root, which
// meant the app named every provider plugin and the registration happened once per PROCESS rather than
// once per boot.
//
// `integration` deliberately registers into BOTH registries and mounts the router in one call, because
// that triple was always performed together and getting it partly right is a broken provider: the
// connection registry backs connect/rotate/test, the integration registry backs the mirrored resources,
// and the route projection is validated against the integration entry. Splitting them into three
// members would let a plugin register a provider whose routes 404 or whose credential cannot be rotated.
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
  // Awaited before the listener binds. That is not a convenience, and there are now two plugins relying on
  // it: plugins/http migrates plaintext credential fields in its init, and plugins/github prunes orphaned
  // mirror rows in its own. A request served before either finished would read half-migrated rows, or a PR
  // whose parent repo row was about to be deleted.
  init(ctx: NodePluginContext): void | Promise<void>
  // A second pass, run after EVERY plugin's init and still before the listener binds.
  //
  // It exists because `init` order is explicitly not load-bearing (server/plugin/host.ts says so), and
  // one real piece of work needs the whole graph assembled rather than one plugin's: plugins/http's
  // legacy-row claim asks "does this node know exactly one owner identity", which only answers correctly
  // once github has filled core's mirror slot. That worked by ALPHABETICAL LUCK — github sorts before
  // http in the plugin list — and reordering the list by domain would have silently stopped claiming the
  // owner's saved API requests, fail-closed and invisible.
  //
  // Anything a plugin can do alone belongs in `init`. This is only for work that reads another plugin's
  // contributions.
  ready?(ctx: NodePluginContext): void | Promise<void>
  // Release what init() opened. Awaited during teardown BEFORE the data root's lock is dropped, because
  // a plugin's SQLite file is in WAL mode and the composition root's own invariant is "only drop the
  // root lock once SQLite is closed, or a restart could open the database while this process still holds
  // its WAL". Without this the plugin database was never closed at all.
  dispose?(): void | Promise<void>
}
