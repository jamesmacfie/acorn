import type { HostOwned } from './shared.js'
import type { DraftAttachmentsCapability } from './attachments.js'

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────

export type Disposable = { dispose(): void }

/** A capability id that carries its own signature, so `get(SOME_ID)` returns the provider's type rather
 *  than `unknown`. `__signature` is never read; it is optional so the brand cannot be built by
 *  accident. */
export type CapabilityId<T> = string & { readonly __signature?: (value: T) => void }

/** One plugin exports a named typed function and another consumes it without importing it
 *  (docs/plugins/collaboration.md § Collaboration rules). Not a DI container: a map with a phantom-typed key.
 *
 * Resolve at call time, never at init: plugin init order is undefined, so a consumer that caches at
 * init may cache `undefined` for a plugin that was simply declared later.
 *
 * An id you provide must start with `<yourPluginId>.`, the same binding the host applies to your
 * routes, schedules and data sources. An id you did not declare in `permissions.node.capabilities`
 * reads as absent, exactly as if the plugin providing it were disabled. */
export type PluginCapabilities = {
  provide<T>(id: CapabilityId<T>, impl: T): Disposable
  get<T>(id: CapabilityId<T>): T | undefined
  /** For a capability whose absence is a bug rather than a configuration. Throws. */
  require<T>(id: CapabilityId<T>): T
  ids(): readonly string[]
}
// ── The capability id catalogue ───────────────────────────────────────────────────────────────────

/** Every capability the first-party plugins publish, with its signature.
 *
 * These are declared in `plugins/*​/src/contract/` modules a loaded plugin cannot import,
 * which is why the catalogue is here. Consuming one means naming its id in
 * `permissions.node.capabilities` and resolving it at call time, never at init: plugin init order is
 * undefined, and the providing plugin may be disabled, in which case `get` returns undefined and you
 * degrade around it.
 *
 * A map rather than exported constants, because this package has no runtime: an `import
 * { NOTES_STORE }` that resolved to nothing at run time would be a worse trap than a cast. Write the
 * one line the cast needs and keep it beside your other ids:
 *
 *     const NOTES_STORE = 'notes.store' as CapabilityIdOf<'notes.store'>
 *     const notes = ctx.capabilities.get(NOTES_STORE)
 *
 * The signature is the call acorn promises; each provider's contract module holds the rest. */
export type CapabilityCatalogue = {
  /** Run a prompt in a managed agent session. */
  'agents.sessionExecute': HostOwned<'plugins/agents/contract/sessionExecute.AgentSessionExecute'>
  /** Ask the agent runtime to reconcile after a restart. */
  'agents.runtime': { reconcile(): Promise<void> }
  /** Read durable turn lifecycle state within one task, without prompt or transcript content. */
  'agents.turns': HostOwned<'plugins/agents/contract/lifecycle.AgentTurnsCapability'>
  /** Rebuild one task's agent input-request inbox. */
  'agents.requests': HostOwned<'plugins/agents/contract/lifecycle.AgentRequestsCapability'>
  /** Rebuild one task's active and archived managed-session roster. */
  'agents.sessions': HostOwned<'plugins/agents/contract/lifecycle.AgentSessionsCapability'>
  /** Read one unsent PNG or JPEG turn attachment, and store an altered copy of it. Never a path, never
   *  a sent attachment, and never the draft itself: the composer decides what is in the turn. */
  'agents.draftAttachments': DraftAttachmentsCapability
  /** The host-declared slot whichever plugin owns agent sessions fills. */
  'agents.harnessRegistry': HostOwned<'node-core/server/plugin/harnesses.HarnessRegistry'>
  /** The host-declared hook fired when a task's worktree first exists. */
  'core.taskWorktreeCreated': (taskId: string, worktreePath: string) => void | Promise<void>
  /** Read and steer this node's terminal sessions. */
  'terminal.sessions': HostOwned<'plugins/terminal/contract/sessions.TerminalSessions'>
  /** Push text into a running agent session's PTY. */
  'terminal.sendToAgent': HostOwned<'plugins/terminal/contract/sendToAgent.TerminalSendToAgent'>
  /** Start, stop and inspect a task's run targets. */
  'terminal.runTargets': HostOwned<'plugins/terminal/contract/runTargets.TerminalRunTargets'>
  /** Read and write task, workspace and global notes. */
  'notes.store': HostOwned<'plugins/notes/contract/store.NotesStoreCapability'>
  /** Seed a new task's notes from its linked external items. */
  'notes.seedTask': HostOwned<'plugins/notes/contract/store.SeedTaskNotes'>
  /** Read the project or private memory library without exposing file paths or recall bookkeeping. */
  'memory.library': HostOwned<'plugins/memory/contract/library.MemoryLibraryCapability'>
  /** Read ordered metadata for one task's retained browser captures. */
  'browser.captures': HostOwned<'plugins/browser/contract/captures.BrowserCapturesCapability'>
  /** The mirrored GitHub read model for a project. */
  'github.mirror': HostOwned<'plugins/github/contract/mirror.GithubMirrorCapability'>
  /** The page rules that decide what a task's preview pane shows. */
  'preview.rules': HostOwned<'plugins/preview/contract/rules.PreviewRulesCapability'>
  /** Read the node-owned preview home selected from recipe, run target, or project config. */
  'preview.urls': HostOwned<'plugins/preview/contract/urls.PreviewUrlsCapability'>
  /** Ask the workflow runner to reconcile after a restart. */
  'workflows.runner': { reconcile(): Promise<void> }
  /** Rebuild a task's pending workflow approval inbox. */
  'workflows.gates': HostOwned<'plugins/workflows/contract/events.WorkflowGatesCapability'>
  /** The per-step event stream behind the run panel. For a bell row, use `events.notice`, which is
   *  core's and works with workflows disabled. */
  'workflows.notices': {
    stepEvent(runId: string, stepId: string, event: unknown): void
  }
}

export type CapabilityIdOf<K extends keyof CapabilityCatalogue> = CapabilityId<CapabilityCatalogue[K]>
/** Shared typed-data version 1. The host validates these declarations before use. */
