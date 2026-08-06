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
import type { AgentToolContribution } from '../agentTools/registry'
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

export type NodePluginContext = {
  readonly name: string
  routes: PluginRouteRegistry
  tools: PluginToolRegistry
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
  // Awaited before the listener binds. That is not a convenience: apps/node/src/wiring/
  // startupSecurity.ts migrates plaintext HTTP-client fields, and a request served before that
  // finishes would read half-migrated rows.
  init(ctx: NodePluginContext): void | Promise<void>
  // Release what init() opened. Awaited during teardown BEFORE the data root's lock is dropped, because
  // a plugin's SQLite file is in WAL mode and the composition root's own invariant is "only drop the
  // root lock once SQLite is closed, or a restart could open the database while this process still holds
  // its WAL". Without this the plugin database was never closed at all.
  dispose?(): void | Promise<void>
}
