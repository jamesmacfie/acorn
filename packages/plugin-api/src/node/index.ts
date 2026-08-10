// The node half of the plugin API. A plugin's node/, server/, main/ and contract/ code imports
// from here and from @acorn/protocol; nothing else in packages/ is reachable to it
// (tools/arch/boundaries.test.ts enforces that).
//
// Everything below is a RE-EXPORT. The implementation stays in node-core, which is free to move
// files around underneath as long as this list keeps resolving. Adding a line here is a contract
// change: src/surface.test.ts fails until the snapshot is updated on purpose.
//
// Deliberately absent, and staying absent:
//   ctx.events.streams()/channel() PTY and WS-channel ownership — exactly one plugin may own those,
//     so they are terminal-plugin infrastructure handed in through ctx, not API.
//   main/wsHub, main/notify — plugins broadcast through ctx, and a ratchet keeps it that way.
//   server/db — a plugin owns its own SQLite file; core's tables are not its business.
//   createCoreServices, createTaskService, testkit/* — test scaffolding. First-party plugin TESTS
//     still import those from node-core directly; that is a first-party privilege, and a
//     third-party author gets @acorn/plugin-api/testkit if and when one is built.

// ── The plugin contract itself ────────────────────────────────────────────────────────────────
export type {
  NodePlugin,
  NodePluginContext,
  PluginBroadcast,
  PluginFetchHandler,
  PluginProviderConnectionVisitor,
  PluginProviderResourceRequest,
  PluginProviderRuntime,
  PluginRequestContext,
} from '@acorn/node-core/server/plugin/types.ts'
// The major this build of the API speaks. A loaded plugin's acorn-plugin.json must name exactly this
// in `apiVersion`, and a build script generating a manifest should read it from here.
export { PLUGIN_API_MAJOR } from '@acorn/node-core/main/pluginManifest.ts'
export type { NodePermissions, PluginManifest } from '@acorn/node-core/main/pluginManifest.ts'
export { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
export type { CapabilityId, Disposable } from '@acorn/node-core/server/plugin/capabilities.ts'

// ── Route toolkit ─────────────────────────────────────────────────────────────────────────────
export type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
export {
  canUseProviderCredential,
  isTaskConfined,
  mayActOnTask,
  ownerId,
  requireDevice,
  requireUser,
} from '@acorn/node-core/server/middleware/requireUser.ts'
export { onServerError, respondError } from '@acorn/node-core/server/respond.ts'
export { BridgeError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/node-core/server/bridge.ts'
export { chunkRowsByColumnBudget } from '@acorn/node-core/server/rows.ts'
// prune candidate: a Hono binding shape, reached by one github route. It is a type, so it costs
// nothing at runtime, but a plugin should be reading its env off ctx rather than naming core's.
export type { Env } from '@acorn/node-core/main/bindings.ts'

// ── Storage ───────────────────────────────────────────────────────────────────────────────────
// Compile-time factories for built-ins. A loaded plugin uses its manifest-bound ctx.storage seam,
// so it cannot choose a database id or discover a migration chain by filesystem proximity.
export { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
export type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
export { pluginMigrationsFolder } from '@acorn/node-core/main/pluginMigrations.ts'

// ── Core services ─────────────────────────────────────────────────────────────────────────────
// The TYPE only. The object arrives on ctx.core; a plugin never constructs one and never
// deep-imports the implementation.
export type { CoreServices, ProjectRef, GenerateTextRequest, ModelService } from '@acorn/node-core/main/core/index.ts'
export { SecretUnavailableError } from '@acorn/node-core/main/core/secrets.ts'
export type { SecretService } from '@acorn/node-core/main/core/secrets.ts'
export type { PrefService } from '@acorn/node-core/main/core/prefs.ts'
export { confineExistingFile } from '@acorn/node-core/main/core/fs.ts'
export { git, gitOrThrow, gitText } from '@acorn/node-core/main/core/git.ts'
export { brokerEnv } from '@acorn/node-core/main/core/proc.ts'

// ── Task, worktree and run configuration ──────────────────────────────────────────────────────
export { buildSessionEnv, childEnv } from '@acorn/node-core/main/taskEnv.ts'
export type { SessionTaskInfo } from '@acorn/node-core/main/taskEnv.ts'
export { isDir, rendererBaseCheckout, taskContext, WORKTREE_CREATED } from '@acorn/node-core/main/taskWorktree.ts'
export type { TaskRow } from '@acorn/node-core/main/taskWorktree.ts'
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
  ProviderProject,
  ProviderProjectContext,
  ProviderProjectSource,
  ProviderResourceContext,
  ProviderResourceRefreshContext,
} from '@acorn/node-core/server/integrations/types.ts'
export { encodeCached, isRecord, parseCached, parseJson } from '@acorn/node-core/server/integrations/codec.ts'
export {
  connectionHasCapability,
  connectProvider,
  ownedConnections,
  ownedExternalItems,
  withOwnedConnections,
} from '@acorn/node-core/server/integrations/connections.ts'
export type { StoredConnection } from '@acorn/node-core/server/integrations/connections.ts'
export { providerCredential } from '@acorn/node-core/server/integrations/credential.ts'
export { providerError } from '@acorn/node-core/server/integrations/respondProvider.ts'
export { providerRequestScheduler } from '@acorn/node-core/server/integrations/budgetRuntime.ts'
export { providerResource } from '@acorn/node-core/server/integrations/resourceRuntime.ts'
export { defaultBudgets, externalIdsFor, publicConnectionProvider, publicProvider } from '@acorn/node-core/server/integrations/providers/shared.ts'
export type { ModelProviderAdapter } from '@acorn/node-core/server/modelProviders/types.ts'
