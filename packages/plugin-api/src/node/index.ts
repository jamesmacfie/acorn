// The node half of the plugin API. A plugin's node/, server/, main/ and contract/ code imports
// from here and from @acorn/protocol; nothing else in packages/ is reachable to it
// (tools/arch/boundaries.test.ts enforces that).
//
// Everything below is a RE-EXPORT. The implementation stays in node-core, which is free to move
// files around underneath as long as this list keeps resolving. Adding a line here is a contract
// change: src/surface.test.ts fails until the snapshot is updated on purpose. TAKING one away is a
// bigger one — regeneration refuses it unless PLUGIN_API_MAJOR moves, which is why sixteen names left
// this file and the number is now '2' (docs/plugins.md § The plugin API).
//
// Every name here has a consumer, and that is the entry criterion: a name on a contract with nothing
// importing it is a promise nobody asked for. `PLUGIN_API_MAJOR` is the single exception, below.
//
// Deliberately absent, and staying absent:
//   ctx.events.streams()/channel() PTY and WS-channel ownership — exactly one plugin may own those,
//     so they are terminal-plugin infrastructure handed in through ctx, not API.
//   main/wsHub, main/notify — plugins broadcast through ctx, and a ratchet keeps it that way.
//   server/db — a plugin owns its own SQLite file; core's tables are not its business.
//   createCoreServices, createTaskService, testkit/* — test scaffolding, and it has its own entrypoint
//     now: @acorn/plugin-api/testkit. A test gets a REAL context from makeTestNodeContext rather than
//     constructing core's services itself, which is why the factories are still not here.

// ── The plugin contract itself ────────────────────────────────────────────────────────────────
export type {
  NodePlugin,
  PluginBroadcast,
  PluginFetchHandler,
  PluginProviderResourceRequest,
  PluginRequestContext,
} from '@acorn/node-core/server/plugin/types.ts'
// What `ctx.taskChecks.register` answers with. Here because a check worth writing is a function, not
// an inline literal, and a function needs a return type to name (server/plugin/taskChecks.ts).
export type { TaskConcern } from '@acorn/node-core/server/plugin/taskChecks.ts'
// The major this build of the API speaks. A loaded plugin's acorn-plugin.json must name exactly this
// in `apiVersion`, and a build script generating a manifest reads it from
// @acorn/protocol/pluginApiVersion.ts, which is where this one comes from too.
//
// The one name on this surface kept without a consumer, on purpose: it is the contract's version, so it
// is here by definition rather than because something imports it. Everything else with a zero consumer
// count was deleted, including the context types — plugins keep `ctx` inside `init`/`activate` and pass
// `ctx.core` onward, so `NodePluginContext` never had to be named. Re-adding any of them is one line;
// carrying them was a promise.
export { PLUGIN_API_MAJOR } from '@acorn/node-core/main/pluginManifest.ts'
export { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'

// ── Route toolkit ─────────────────────────────────────────────────────────────────────────────
export type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
export { isTaskConfined, mayActOnTask, ownerId, requireDevice, requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
export { onServerError, respondError } from '@acorn/node-core/server/respond.ts'
// The portable carrier, both halves. A loaded plugin serves a fetch handler and builds its routes with
// its own Hono; this is how the request context gets from one to the other, and it is here so the four
// loaded plugins stop keeping four copies of it.
export { portableCarrier } from '@acorn/node-core/server/plugin/portable.ts'
export { BridgeError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/node-core/server/bridge.ts'
export { chunkRowsByColumnBudget } from '@acorn/node-core/server/rows.ts'
// `Env` — core's runtime bindings, SECRETS/ACTIVE_IDENTITY/INTERNAL_TOKEN and friends — used to be here
// for one github route that wanted `Env['BLOBS']`. It named the whole binding set to reach two methods.
// A plugin reads its env off `ctx`; where it genuinely needs a store, it states the two methods it calls
// (plugins/github/src/server/routes/prMirror.ts § PatchBlobStore).

// ── Storage ───────────────────────────────────────────────────────────────────────────────────
// The HANDLE type, and nothing else. Both tiers get their database from `ctx.storage.open()`: declare
// `migrationsModule: import.meta.url` on the plugin (a built-in) or `migrations` in the manifest (a
// loaded package), and the host owns open, migrate and close. `openPluginDb` and
// `pluginMigrationsFolder` were exported here until the eight built-ins that hand-rolled that
// lifecycle adopted the seam; a plugin choosing its own database filename or discovering a chain by
// filesystem proximity is what the seam exists to prevent.
export type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

// ── Core services ─────────────────────────────────────────────────────────────────────────────
// The TYPE only. The object arrives on ctx.core; a plugin never constructs one and never
// deep-imports the implementation. `ProjectRef` and `TaskRef` are the projections it hands back for a
// core entity — never a drizzle row, never the core SQLite handle.
export type { CoreServices, ProjectRef, TaskRef, GenerateTextRequest, ModelService } from '@acorn/node-core/main/core/index.ts'
export { SecretUnavailableError } from '@acorn/node-core/main/core/secrets.ts'
export type { SecretService } from '@acorn/node-core/main/core/secrets.ts'
export type { PrefService } from '@acorn/node-core/main/core/prefs.ts'
export { confineExistingFile } from '@acorn/node-core/main/core/fs.ts'
export { git, gitOrThrow, gitText } from '@acorn/node-core/main/core/git.ts'
export { brokerEnv } from '@acorn/node-core/main/core/proc.ts'

// ── Task, worktree and run configuration ──────────────────────────────────────────────────────
export { buildSessionEnv, childEnv } from '@acorn/node-core/main/taskEnv.ts'
export type { SessionTaskInfo } from '@acorn/node-core/main/taskEnv.ts'
// `taskContext` and the WORKTREE_CREATED hook take a TaskRef (above), not the `tasks` row: the row was
// `typeof schema.tasks.$inferSelect`, so a column rename in core was a silent plugin break.
export { isDir, rendererBaseCheckout, taskContext, WORKTREE_CREATED } from '@acorn/node-core/main/taskWorktree.ts'
export { loadRepoConfig } from '@acorn/node-core/main/runConfig.ts'
export type { LayoutRecipe, RunTarget } from '@acorn/node-core/main/runConfig.ts'
export { isRepoConfigTrustError } from '@acorn/node-core/main/repoConfigTrust.ts'
export { TEARDOWN_TIMEOUT_MS } from '@acorn/node-core/main/archive.ts'
export { TASK_CREATED, TASK_SESSIONS } from '@acorn/node-core/server/routes/worktree.ts'
export type { TaskCreatedHook, TaskSessionsBridge } from '@acorn/node-core/server/routes/worktree.ts'
export { RUN_TARGETS } from '@acorn/node-core/server/routes/harness.ts'

// ── Agents: profiles, headless runs, MCP registration ─────────────────────────────────────────
export { agentProfileRegistry, DEFAULT_PROFILE_ID } from '@acorn/node-core/main/agentProfiles/index.ts'
export { lineDelimitedJsonAdapter } from '@acorn/node-core/main/agentProfiles/streamJson.ts'
export type { AgentProfileContribution } from '@acorn/node-core/main/agentProfiles/types.ts'
export { buildHeadlessArgv, HEADLESS_TIMEOUT_MS, runHeadless } from '@acorn/node-core/main/headless.ts'
export type { HeadlessOpts, HeadlessResult, StreamEvent } from '@acorn/node-core/main/headless.ts'
export {
  getProfile,
  listProfileDefs,
  listProfiles,
  profileAvailable,
  requireProfile,
  resolveCommand,
  tmuxAvailable,
} from '@acorn/node-core/main/profiles.ts'
export type { ProfileDef } from '@acorn/node-core/main/profiles.ts'
export { launcherSpec, registerAcornMcp, resolveMcpEntry, serverName } from '@acorn/node-core/main/mcpRegister.ts'
export type { Launcher } from '@acorn/node-core/main/mcpRegister.ts'

// ── Agent tools ───────────────────────────────────────────────────────────────────────────────
export { ToolError } from '@acorn/node-core/server/agentTools/registry.ts'
export type { AgentToolContribution, ToolContext } from '@acorn/node-core/server/agentTools/registry.ts'
export { memorySection, notesSection, pullRequestSection } from '@acorn/node-core/server/agentTools/contextSections.ts'
export type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'

// ── Blobs and the sync engine ─────────────────────────────────────────────────────────────────
export { fileBodyBlobKey, patchBlobKey } from '@acorn/node-core/server/blobs.ts'
export { serveThenRevalidate } from '@acorn/node-core/server/sync/engine.ts'
export type { Cached, RefreshResult, RouteFailure, RouteResult } from '@acorn/node-core/server/sync/engine.ts'

// ── Integrations and providers ────────────────────────────────────────────────────────────────
export { ProviderOperationError } from '@acorn/node-core/server/integrations/types.ts'
export type {
  CachedExternalItem,
  CachedItemCodec,
  CodecResult,
  MirroredResourceContribution,
  ProviderProjectSource,
  ProviderResourceContext,
  ProviderResourceRefreshContext,
} from '@acorn/node-core/server/integrations/types.ts'
export { encodeCached, isRecord, parseCached, parseJson } from '@acorn/node-core/server/integrations/codec.ts'
export { connectionHasCapability, connectProvider } from '@acorn/node-core/server/integrations/connections.ts'
export type { StoredConnection } from '@acorn/node-core/server/integrations/connections.ts'
export { providerCredential } from '@acorn/node-core/server/integrations/credential.ts'
export { providerError } from '@acorn/node-core/server/integrations/respondProvider.ts'
export { providerRequestScheduler } from '@acorn/node-core/server/integrations/budgetRuntime.ts'
export { defaultBudgets, externalIdsFor, publicConnectionProvider, publicProvider } from '@acorn/node-core/server/integrations/providers/shared.ts'
export type { ModelProviderAdapter } from '@acorn/node-core/server/modelProviders/types.ts'
