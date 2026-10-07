import type { HostOwned } from './shared.js'

export type CoreContextService = {
  /** The owner's `startup_context_injection` pref. Absent means true. */
  injectionEnabled(userId: string): Promise<boolean>
  assemble(userLogin: string, taskId: string, include: Set<string>): Promise<HostOwned<'protocol/api.TaskContext'> | null>
}

/** Text generation through a stored model-provider connection or an installed agent CLI. You own the
 *  prompt; core owns credential resolution and the provider adapters. */
export type CoreModelService = {
  /** One turn of a backend, as text.
   *
   *  Name a `backendId` and that backend runs: the person picked it from a dropdown and your route passes
   *  it through. That path is unchanged and is only counted.
   *
   *  Leave `backendId` out and the host spends the model grant the owner set for your plugin in
   *  Settings > Plugins: their backend, their model, and a daily output-token allowance. `userId` must be
   *  `ctx.core.identity.active()`, and `input.modelId` must be absent. With no grant this throws
   *  `provider_not_configured`; past today's allowance, `provider_budget_exhausted`. Neither spends.
   *  The allowance covers this path only, not calls that name a backend. */
  generateText(
    request: HostOwned<'node-core/server/core/models.PluginGenerateTextRequest'>,
  ): Promise<HostOwned<'node-core/server/modelProviders/types.GenerateTextResult'>>
  /** Which backends this owner could generate with — a stored API key, or an agent CLI installed on
   *  this machine — as ids and labels only. Connections come first, so a plugin that falls back to
   *  `[0]` keeps spending the key the owner configured. Prefer leaving `backendId` out over `[0]`. */
  available(userId: string): Promise<Array<HostOwned<'protocol/modelProviders.ModelBackend'>>>
}

/** One `(userId, key)` row. A loaded plugin's reads and writes are confined to `plugin:<yourId>:*`,
 *  the same namespace your frames persist into, and values are capped at 1 MiB. */
export type CorePrefService = {
  /** `null` when the owner has never set this key, which is not the same as `''`. */
  read(userId: string, key: string): Promise<string | null>
  write(userId: string, key: string, value: string): Promise<void>
}

export type CoreIdentityService = {
  /** The identity bound to this machine. Read per call rather than cached. */
  active(): string | null
}

/** One attachment on an agent turn, as `agents.draftAttachments` describes it.
 *
 * Written out rather than aliased to `HostOwned`, unlike most of the shapes another plugin's contract
 * owns. The whole point of that capability is that a plugin outside this repository can use it, and an
 * opaque brand would leave such a plugin casting the return value of every call. Six fields of plain
 * data, and no path: where the bytes live is never something a consumer learns. */
