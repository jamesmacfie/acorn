// The node half of the plugin API. See docs/plugins.md § The plugin API for the re-export rule,
// the surface snapshot, and what PLUGIN_API_MAJOR guards.
//
// Off this surface, and staying off:
//   ctx.events.streams()/channel(), PTY and WS-channel ownership. Exactly one plugin may own those,
//     so they are terminal-plugin infrastructure handed in through ctx, not API.
//   main/wsHub, main/notify. Plugins broadcast through ctx, and a ratchet keeps it that way.
//   server/db. A plugin owns its own SQLite file; core's tables are not its business.
//   createCoreServices, createTaskService, testkit/*. Test scaffolding has its own entrypoint,
//     @acorn/plugin-api/testkit. A test gets a real context from makeTestNodeContext rather than
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
// The major this build of the API speaks (docs/plugins.md § The plugin API covers what it guards
// and why it is the one name kept without a consumer, since it is the contract's version rather
// than an import target).
//
// Context types were not re-added alongside it: a plugin keeps `ctx` inside `init`/`activate` and
// passes `ctx.core` onward, so `NodePluginContext` never had to be named on this surface.
export { PLUGIN_API_MAJOR } from '@acorn/node-core/main/pluginManifest.ts'
export { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'

// ── Route toolkit ─────────────────────────────────────────────────────────────────────────────
export type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
export { isTaskConfined, mayActOnTask, ownerId, requireDevice, requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
export { onServerError, respondError } from '@acorn/node-core/server/respond.ts'
// The portable carrier a loaded plugin uses to run its own Hono router through
// `ctx.routes.fetch` (docs/plugins.md § Loaded plugins).
export { portableCarrier } from '@acorn/node-core/server/plugin/portable.ts'
export { BridgeError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/node-core/server/bridge.ts'
export { chunkRowsByColumnBudget } from '@acorn/node-core/server/rows.ts'
// `Env`, core's runtime bindings (SECRETS, ACTIVE_IDENTITY, INTERNAL_TOKEN and friends), used to be
// here for one github route that wanted `Env['BLOBS']`. It named the whole binding set to reach two
// methods. A plugin reads its env off `ctx`; where it genuinely needs a store, it states the two
// methods it calls (plugins/github/src/server/routes/prMirror.ts § PatchBlobStore).

// ── Storage ───────────────────────────────────────────────────────────────────────────────────
// The handle type only; see docs/data-layer.md and docs/plugins.md § Data ownership for
// `ctx.storage.open()` and how a plugin declares its migrations.
//
// `openPluginDb` and `pluginMigrationsFolder` were exported here until the eight built-ins that
// hand-rolled that lifecycle adopted the seam.
export type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

// ── Core services ─────────────────────────────────────────────────────────────────────────────
// The type only; the object arrives on `ctx.core`, and a plugin never constructs one or deep-imports
// the implementation. See docs/plugins.md § The plugin API for why `ProjectRef` and `TaskRef` are
// projections rather than the drizzle row.
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
// Takes a `TaskRef` (above), not the `tasks` row; see docs/plugins.md § The plugin API for why a
// column rename in core would otherwise be a silent plugin break.
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
