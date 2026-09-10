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
// `PluginHook*` are named here for the same reason `TaskConcern` below is: a plugin that opens a hook
// passes `ctx.hooks` into the module that runs it, and a parameter needs a type to name
// (server/pluginHost/hooks.ts, docs/plugins.md § Hooks).
export type {
  NodePlugin,
  CompiledPluginBroadcast,
  PluginBroadcast,
  PluginFetchHandler,
  PluginHookHandler,
  PluginHookPoint,
  PluginHookRegistry,
  PluginProviderResourceRequest,
  PluginRequestContext,
} from '@acorn/node-core/server/pluginHost/types.ts'
export type { HookMode, HookPayload, HookPayloadShape, HookVerdict } from '@acorn/protocol/extensionPoints.ts'
// What `ctx.taskChecks.register` answers with. Here because a check worth writing is a function, not
// an inline literal, and a function needs a return type to name (server/pluginHost/taskChecks.ts).
export type { TaskConcern } from '@acorn/node-core/server/pluginHost/taskChecks.ts'
// The major this build of the API speaks. docs/plugins.md § The plugin API covers what it guards, and
// why it is the one name kept without a consumer.
//
// The context types are not here: a plugin keeps `ctx` inside `init`/`activate` and passes `ctx.core`
// onward, so `NodePluginContext` never has to be named.
export { PLUGIN_API_MAJOR } from '@acorn/node-core/server/plugins/manifest.ts'
export { capabilityId } from '@acorn/node-core/server/pluginHost/capabilities.ts'
export type { Disposable } from '@acorn/node-core/server/pluginHost/capabilities.ts'
// The many-provider seam beside capabilities (docs/plugins.md § Cooperative extension points). Only
// the id minter and the entry type: `open`, `contribute` and `entries` arrive on
// `ctx.extensionPoints`, and a plugin that imported the registry directly would get its own copy of
// the maps, since a loaded bundle inlines every @acorn/* import it makes.
export { extensionPointId } from '@acorn/node-core/server/pluginHost/extensionPoints.ts'
export type { Extension, ExtensionPointId } from '@acorn/node-core/server/pluginHost/extensionPoints.ts'
// The managed agent harness seam (docs/managed-agents.md § Harnesses). The capability id and its
// shape live in node-core rather than in the agents plugin, because the host delivers a
// manifest-declared harness and neither package may import the other.
export { AGENTS_HARNESS_REGISTRY } from '@acorn/node-core/server/pluginHost/harnesses.ts'
export type { HarnessProbe, HarnessRegistry, ManifestHarness, ManifestHarnessSpawn } from '@acorn/node-core/server/pluginHost/harnesses.ts'

// ── Route toolkit ─────────────────────────────────────────────────────────────────────────────
export type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
export { isTaskConfined, mayActOnTask, ownerId, requireDevice, requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
export { onServerError, respondError } from '@acorn/node-core/server/respond.ts'
// The portable carrier a loaded plugin uses to run its own Hono router through
// `ctx.routes.fetch` (docs/plugins.md § Loaded plugins).
export { portableCarrier } from '@acorn/node-core/server/pluginHost/portable.ts'
export { BridgeError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/node-core/server/bridge.ts'
export { chunkRowsByColumnBudget } from '@acorn/node-core/server/rows.ts'
// `Env`, core's runtime bindings, is not here. A plugin reads its env off `ctx`. Where it needs a
// store, it states the methods it calls (plugins/github/src/server/routes/prMirror.ts §
// PatchBlobStore).

// ── Telemetry and logging ─────────────────────────────────────────────────────────────────────
// The objects arrive on `ctx.telemetry`, `ctx.log` and `ctx.core.telemetry`; the types are here
// because a plugin that passes one into a module of its own needs a parameter type to name
// (docs/telemetry.md, docs/plugin-authoring.md § Telemetry and logging). `TelemetrySink` is what a
// plugin holding the `telemetry` token writes.
export type { PluginTelemetry, SpanHandle, TelemetrySink } from '@acorn/node-core/server/telemetry/collector.ts'
// The one value in this block, for a compiled plugin's module-level code with no `ctx` in reach: a
// PTY engine, a route factory, a driver. Pass your own plugin id as the owner and the tag you
// already had in the string you were prefixing, so `[github] pruned 3 rows` keeps reading the same
// and gains an owner. A loaded plugin uses `ctx.log`, which binds the id for it.
//
// `describeError` beside it because a logger takes scalars: it turns a caught `unknown` into a name
// and a scrubbed one-line message, which is what goes in the line.
export { createLogger, describeError } from '@acorn/node-core/server/telemetry/logger.ts'
export type { Logger } from '@acorn/node-core/server/telemetry/logger.ts'
// The rule from docs/telemetry.md § What never leaves the machine, as a function, for the one
// plugin shape that needs it: a sink, which is the last thing a record passes through before the
// network. Core scrubs at the ingest door, so a sink is re-checking rather than cleaning, and a
// span name or a metric name is the part core takes on trust as a pattern.
//
// Exported rather than copied because there are already two copies of these token patterns in this
// repository and the header of each says a change belongs in both. A third, inside a plugin whose
// whole job is egress, is the copy that would rot unnoticed.
export { scrub } from '@acorn/node-core/server/telemetry/scrub.ts'
export type { TelemetryService } from '@acorn/node-core/server/core/telemetry.ts'
export type {
  TelemetryAttrs,
  TelemetryBatch,
  TelemetryRecord,
} from '@acorn/protocol/telemetry.ts'

// ── Storage ───────────────────────────────────────────────────────────────────────────────────
// The handle type only. See docs/data-layer.md and docs/plugins.md § Data ownership for
// `ctx.storage.open()` and how a plugin declares its migrations.
export type { PluginDatabase } from '@acorn/node-core/server/plugins/storage.ts'

// ── Core services ─────────────────────────────────────────────────────────────────────────────
// The type only; the object arrives on `ctx.core`, and a plugin never constructs one or deep-imports
// the implementation. See docs/plugins.md § The plugin API for why `ProjectRef` and `TaskRef` are
// projections rather than the drizzle row.
export type { CoreFsService, CoreGitService, CoreProcService, CoreServices, ProjectRef, TaskRef, GenerateTextRequest, ModelService } from '@acorn/node-core/server/core/index.ts'
export { SecretUnavailableError } from '@acorn/node-core/server/core/secrets.ts'
export type { SecretService } from '@acorn/node-core/server/core/secrets.ts'
export type { PrefService } from '@acorn/node-core/server/core/prefs.ts'
export { confineExistingFile } from '@acorn/node-core/server/core/fs.ts'
export { git, gitOrThrow, gitText } from '@acorn/node-core/server/core/git.ts'
// The coalesced `git status` for a worktree: one process per path per two seconds however many callers
// ask, so a plugin reading local changes and core reading the rail's dirty markers share one spawn
// (docs/workspaces-and-tasks.md § Worktree status reads). `invalidateWorktreeStatus` is for a plugin
// that has just written under a worktree itself; the ordinary announcement is
// `ctx.events.worktreeStatus(taskId)`.
export { invalidateWorktreeStatus, worktreeStatusText } from '@acorn/node-core/server/worktrees/worktreeStatus.ts'
export { brokerEnv } from '@acorn/node-core/server/core/proc.ts'

// ── Task, worktree and run configuration ──────────────────────────────────────────────────────
export { buildSessionEnv, childEnv } from '@acorn/node-core/server/taskEnv.ts'
export type { SessionTaskInfo } from '@acorn/node-core/server/taskEnv.ts'
// Takes a `TaskRef` (above), not the `tasks` row; see docs/plugins.md § The plugin API for why a
// column rename in core would otherwise be a silent plugin break.
export { isDir, rendererBaseCheckout, taskContext } from '@acorn/node-core/server/worktrees/taskWorktree.ts'
export { loadRepoConfig } from '@acorn/node-core/server/runConfig.ts'
export type { LayoutRecipe, RunTarget } from '@acorn/node-core/server/runConfig.ts'
export { isRepoConfigTrustError } from '@acorn/node-core/server/repoConfigTrust.ts'
export { TEARDOWN_TIMEOUT_MS } from '@acorn/node-core/server/storage/archive.ts'
export { TASK_CREATED, TASK_SESSIONS } from '@acorn/node-core/server/routes/projects/worktree.ts'
export type { TaskCreatedHook, TaskSessionsBridge } from '@acorn/node-core/server/routes/projects/worktree.ts'
export { RUN_TARGETS } from '@acorn/node-core/server/routes/plugins/harness.ts'

// ── Agents: profiles, headless runs, MCP registration ─────────────────────────────────────────
export { agentProfileRegistry, DEFAULT_PROFILE_ID } from '@acorn/node-core/server/agentProfiles/index.ts'
// Three stdout readings, because the CLIs frame their answers differently and a profile picks the one
// that matches its own. See streamJson.ts for what codex emits instead of a `result` event, and for why
// `textAdapter` reads a plain-text one-shot.
export { codexJsonAdapter, lineDelimitedJsonAdapter, textAdapter } from '@acorn/node-core/server/agentProfiles/streamJson.ts'
// The extra environment an agent CLI needs on top of `brokerEnv`'s base allowlist. In core because
// core spawns a CLI itself for a one-shot generate, and here because the drivers that spawn the
// interactive ones live in a plugin.
export { AGENT_TOOL_PASSTHROUGH } from '@acorn/node-core/server/agentProfiles/toolEnv.ts'
export type { AgentProfileContribution } from '@acorn/node-core/server/agentProfiles/types.ts'
export { buildHeadlessArgv, HEADLESS_TIMEOUT_MS, runHeadless } from '@acorn/node-core/server/headless.ts'
export type { HeadlessOpts, HeadlessResult, StreamEvent } from '@acorn/node-core/server/headless.ts'
export {
  getProfile,
  listProfileDefs,
  listProfiles,
  profileAvailable,
  requireProfile,
  resolveCommand,
  tmuxAvailable,
} from '@acorn/node-core/server/profiles.ts'
export type { ProfileDef } from '@acorn/node-core/server/profiles.ts'
export { envFlags, launcherSpec, registerAcornMcp, resolveMcpEntry, serverName } from '@acorn/node-core/server/mcpRegister.ts'
export type { Argv, Launcher, McpCommands } from '@acorn/node-core/server/mcpRegister.ts'

// ── Agent tools ───────────────────────────────────────────────────────────────────────────────
export { ToolError } from '@acorn/node-core/server/agentTools/registry.ts'
export type { AgentToolContribution, ToolContext } from '@acorn/node-core/server/agentTools/registry.ts'
// The context-section helpers, not the sections: `pr`, `notes` and `memory` are shaped by the plugins
// that own their rows (docs/agent-tools.md § Context sections).
export { formatOmitted, truncateBytes } from '@acorn/node-core/server/agentTools/contextSections.ts'
export type { PluginContextSection } from '@acorn/node-core/server/agentTools/contextSections.ts'
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
  ProviderDetailContext,
  ProviderItemDetail,
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
export { defaultBudgets, externalIdsFor, publicConnectionProvider, publicProvider } from '@acorn/node-core/server/integrations/providerShared.ts'
export type { ModelProviderAdapter } from '@acorn/node-core/server/modelProviders/types.ts'
// The node-provider contract (docs/plugins.md § Node providers). Types only: the provider arrives on
// `ctx.providers.nodes`, and a plugin that imported the registry directly would get its own copy of
// the map, since a loaded bundle inlines every @acorn/* import it makes. `ProvidedNode` and its state
// enum live in @acorn/protocol, which a plugin already depends on.
export type { NodeProviderContribution, NodeSpec, ProvidedNodeRecord } from '@acorn/node-core/server/nodeProviders/registry.ts'
