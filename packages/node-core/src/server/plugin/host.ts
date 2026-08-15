// The plugin host: builds each plugin's context and runs its init, in declaration order.
//
// Replaces the hand-ordered sequence of eleven wireX() calls in apps/node/src/service/runtime.ts.
// The ordering there was load-bearing (knowledge.notesStore, runtimeService and managedAgents were
// constructed and threaded as deps between calls); here it must NOT be, because a disabled plugin
// removes a step from the sequence. Cross-plugin needs resolve through the capability registry at
// CALL time instead, which is why capabilities.get() is documented as late-binding.
import type { CoreServices } from '../../main/core'
import { builtinPluginStorage, type PluginDatabase } from '../../main/pluginStorage'
import { removeAgentTools } from '../agentTools/registry'
import { removeContextSections } from '../agentTools/contextSections'
import { removePluginRoutes } from '../routeRegistry'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import type { CapabilityRegistry } from './capabilities'
import { buildPluginContext, revokePluginContext, type LoadedPluginBinding } from './context'
import type { NodePlugin, NodePluginContext, PluginStorage } from './types'

// What each plugin claimed on the WS hub, so a re-init can take it back. The hub's slots are module
// singletons with no duplicate guard, unlike the route and tool registries.
const wsRegistrations = new Map<string, (() => void)[]>()

// Re-exported from its new home: the loader and the composition root import it from here, and the
// context shape it feeds moved to context.ts so a test can build the same context the host does.
export type { LoadedPluginBinding }

export type PluginHostOptions = {
  // Owned by the caller, not by this module: see the note in capabilities.ts about why these are not
  // module singletons.
  capabilities: CapabilityRegistry
  core: CoreServices
  // The node's data root, because the host — not the plugin — opens the per-plugin SQLite files under
  // it (main/pluginStorage.ts). Required rather than optional: a caller that forgot it would boot a
  // graph whose plugins silently found no `ctx.storage`, and a compile error is cheaper than that.
  dataDir: string
  // Plugin ids the owner has turned off for this node. `required` plugins ignore it — disabling
  // github, terminal or agents is not a supported configuration, and silently honouring it would
  // produce a node that boots and then fails at the first task.
  disabled?: readonly string[]
  // The plugins that came off disk, keyed by name, carrying their permission projection and
  // manifest-bound storage. Membership in this map is the ONE flag that separates a loaded plugin
  // from a built-in: it means "contain its failures" and "shape its context from the manifest".
  //
  // It lives in the host's options rather than on NodePlugin because the distinction is the host's
  // to draw. A field on the plugin object would be a value the plugin's own bundle could set.
  loaded?: ReadonlyMap<string, LoadedPluginBinding>
}

// One row per plugin the composition root offered, whether or not it ran. Settings → Plugins needs the
// whole list — a plugin the owner has turned off has to still appear, with a checkbox — and `enabled`
// plus `skipped` is not that list: it says nothing about which names are `required` and therefore not
// togglable at all.
export type PluginRosterEntry = {
  name: string
  required: boolean
  disabled: boolean
  // What actually happened to this plugin in THIS process. `disabled` above is what the owner asked
  // for; this is the outcome, and 'failed' is a state only a loaded plugin can reach.
  state: 'active' | 'failed' | 'disabled'
  // When it failed, so the client's attention item can say how long it has been broken.
  failedAt?: number
  // What it threw, verbatim, for the owner to read. The message used to die in this process's stdout,
  // which a packaged app shows to nobody. It is plugin-authored text on its way to the owner's UI:
  // display-only, rendered as text and capped at the wire boundary (server/plugin/pluginState.ts).
  reason?: string
  // Which pass it died in. 'load' never comes from the host — it is the loader's failure, folded into the
  // roster one layer up — but the client renders all three from one field, so the vocabulary lives here.
  stage?: 'load' | 'init' | 'ready'
}

export type PluginFailure = { name: string; error: string; at: number; stage: 'init' | 'ready' }

// The new instance, as the caller took it off disk. The host does no filesystem work of its own — the
// loader owns importing a bundle and confining its migrations chain (main/pluginReload.ts drives both).
export type PluginReloadRequest = { plugin: NodePlugin; binding: LoadedPluginBinding }
export type PluginReloadOutcome = { ok: true } | { ok: false; error: string }

export type PluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
  // Loaded plugins whose init or ready threw. Their registrations were rolled back and boot
  // continued; built-ins are never in here, because a built-in throwing still fails the boot.
  failed: readonly PluginFailure[]
  // Mutable in place, deliberately: `reload` below changes a row's outcome in a running process, and the
  // PLUGIN_STATE bridge holds this array by reference (`roster: () => plugins.roster`).
  roster: readonly PluginRosterEntry[]
  /** Swap one LOADED plugin's node half in a running process — candidate-then-commit
   * (docs/plugins.md § The dev loop).
   *
   * The candidate's `init` runs against a buffered registration set (server/plugin/context.ts § pending),
   * so a throw leaves the previous instance registered, serving, and holding its database — the failure
   * lands as status detail on the roster row and nothing else moves. Only on success is the previous
   * instance cleared, disposed, its handle closed and its context revoked.
   *
   * Loaded plugins only. A built-in is compiled into this binary and keeps restart-required semantics;
   * there is no second copy of it on disk to swap in. */
  reload(name: string, next: PluginReloadRequest): Promise<PluginReloadOutcome>
  // Release every initialized plugin, newest first, and close the `ctx.storage` database each one
  // opened — all of it before the data root lock is dropped. Never rejects: one plugin failing to close
  // must not stop the rest, and teardown is already best-effort.
  dispose(): Promise<void>
}

export async function initPlugins(plugins: readonly NodePlugin[], options: PluginHostOptions): Promise<PluginHostResult> {
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) throw new Error(`Duplicate node plugin: ${plugin.name}`)
    seen.add(plugin.name)
  }
  const disabled = new Set(options.disabled ?? [])
  const enabled: string[] = []
  const skipped: string[] = []
  const failed: PluginFailure[] = []
  const started: NodePlugin[] = []
  // Kept so the ready pass below hands each plugin the SAME context its init got.
  const contexts = new Map<string, NodePluginContext>()
  // The loaded bindings, seeded from the boot options and REPLACED by a successful reload: after a swap
  // the running instance's permissions and migrations chain are the new manifest's, not the boot one's.
  // Membership is also the answer to "may this name be reloaded at all".
  const loadedBindings = new Map(options.loaded ?? [])

  // Every database handed out through `ctx.storage`, so the host can close what it opened. Per CALL,
  // not a module singleton: a second startServiceRuntime in one process gets its own handles, exactly
  // as it gets its own capability registry.
  //
  // Memoized per plugin, which is a behaviour change the plugins can see: two open() calls used to mean
  // two handles on one file and one of them leaked. There is one connection per plugin per boot now.
  const opened = new Map<string, PluginDatabase>()
  const storageFor = (plugin: NodePlugin, loaded?: LoadedPluginBinding): PluginStorage | undefined => {
    // The loaded binding first and unconditionally (server/plugin/context.ts says why); `migrationsModule`
    // is the compiled tier's declaration and is only ever read for a plugin that is NOT loaded.
    const source = loaded?.storage
      ?? (plugin.migrationsModule ? builtinPluginStorage(options.dataDir, plugin.name, plugin.migrationsModule) : null)
    if (!source) return undefined
    return {
      open: () => {
        const existing = opened.get(plugin.name)
        if (existing) return existing
        const db = source.open()
        opened.set(plugin.name, db)
        return db
      },
    }
  }
  // Called after a plugin's own dispose has run, never before: agents flushes its transcript, workflows
  // aborts live steps and database drains its pools THROUGH this handle, so closing it first would turn
  // a clean shutdown into writes on a dead connection.
  const closeStorage = (name: string): void => {
    const db = opened.get(name)
    if (!db) return
    opened.delete(name)
    try {
      db.close()
    } catch {
      // An older loaded bundle may still close its own handle in dispose, and node:sqlite refuses a
      // second close. Nothing to report: the file is drained either way.
    }
  }

  // Roll a contained plugin back to the state it was in before init: undo everything it registered,
  // let it release whatever it opened, and record why. Boot continues — that is the entire point of
  // the contained path, and the difference between "one installed plugin is broken" and "this node
  // does not start".
  const contain = async (plugin: NodePlugin, phase: 'init' | 'ready', error: unknown): Promise<void> => {
    console.error(`[plugin:${plugin.name}] ${phase} failed; the plugin is disabled for this boot:`, error)
    clearRegistrations(plugin.name)
    try {
      await plugin.dispose?.()
    } catch (disposeError) {
      console.warn(`[plugin:${plugin.name}] dispose after a failed ${phase} also failed:`, disposeError)
    }
    // Including the database it opened before it threw — a contained failure that left a WAL handle on
    // the data root would be the same lock leak initPlugins' dispose contract exists to prevent.
    closeStorage(plugin.name)
    failed.push({ name: plugin.name, error: error instanceof Error ? error.message : String(error), at: Date.now(), stage: phase })
  }

  for (const plugin of plugins) {
    // Clearing happens BEFORE the disabled check, not after. These registries are module singletons, so
    // a plugin DISABLED on the second boot of one process would otherwise keep the first boot's routes,
    // tools and providers — served through a database handle its dispose already closed. That is the
    // trap the disable flag exists to avoid, so the flag has to be honoured on the clear path too.
    clearRegistrations(plugin.name)
    if (disabled.has(plugin.name) && !plugin.required) {
      skipped.push(plugin.name)
      continue
    }
    // Undefined for a built-in, the manifest's `permissions.node` block for a plugin loaded from
    // disk; its presence is what shapes the context (server/plugin/context.ts).
    const loaded = options.loaded?.get(plugin.name)
    const permissions = loaded?.permissions
    const storage = storageFor(plugin, loaded)
    const ctx = buildPluginContext({
      plugin: plugin.name,
      capabilities: options.capabilities,
      core: options.core,
      loaded,
      ...(storage ? { storage } : {}),
      onWsRegistration: (undo) => wsRegistrations.set(plugin.name, [...(wsRegistrations.get(plugin.name) ?? []), undo]),
    })
    // A failing init still fails the boot — every plugin here is first-party code in the same binary, so
    // a node that cannot assemble should say so rather than run degraded. But the plugins that ALREADY
    // initialized have to be torn down first, and that is not cosmetic: each holds a WAL-mode SQLite
    // handle, and the composition root's catch releases the data-root lock. Without this, a throw from
    // plugin five of fifteen dropped the lock with fourteen open handles, a live idle-watch interval and
    // running provider children — precisely the invariant this file's `dispose` contract promises.
    //
    // The caller cannot do it: it only receives the dispose closure from a RESOLVED result.
    //
    // A LOADED plugin gets the opposite treatment: it is contained. Third-party code failing is a
    // normal event, not a broken build, and a node that refused to start because one installed
    // plugin threw would be unusable exactly when the owner needs to go and disable it.
    try {
      await plugin.init(ctx)
    } catch (error) {
      if (permissions) {
        await contain(plugin, 'init', error)
        continue
      }
      await disposeStarted(started, closeStorage)
      throw error
    }
    contexts.set(plugin.name, ctx)
    started.push(plugin)
    enabled.push(plugin.name)
  }

  // The second pass, after every init: a plugin that must read another plugin's contributions runs here
  // rather than depending on where it happens to sit in the list. Still before the listener binds, and a
  // failure tears down exactly as an init failure does.
  // Iterated over a copy, because containing a failure removes the plugin from `started`.
  for (const plugin of [...started]) {
    if (!plugin.ready) continue
    try {
      await plugin.ready(contexts.get(plugin.name)!)
    } catch (error) {
      if (options.loaded?.has(plugin.name)) {
        await contain(plugin, 'ready', error)
        // Out of both lists: `contain` already disposed it, and leaving it in `started` would dispose
        // it a second time at shutdown, through a plugin that has already released its resources.
        started.splice(started.indexOf(plugin), 1)
        enabled.splice(enabled.indexOf(plugin.name), 1)
        continue
      }
      await disposeStarted(started, closeStorage)
      throw error
    }
  }

  // Built from the offered list, in declaration order, so a plugin that was skipped still has a row.
  // `disabled` reports what the OWNER asked for, not what the host did — a required plugin named in the
  // list reads `{ required: true, disabled: false }`, because it is running and the UI must not offer to
  // turn it off.
  const failures = new Map(failed.map((entry) => [entry.name, entry]))
  const roster = plugins.map((plugin): PluginRosterEntry => {
    const isDisabled = disabled.has(plugin.name) && plugin.required !== true
    const failure = failures.get(plugin.name)
    return {
      name: plugin.name,
      required: plugin.required === true,
      disabled: isDisabled,
      // A failure outranks the disabled flag in this field only because the two cannot co-occur: a
      // disabled plugin never ran, so it never failed.
      state: failure ? 'failed' : isDisabled ? 'disabled' : 'active',
      ...(failure ? { failedAt: failure.at, reason: failure.error, stage: failure.stage } : {}),
    }
  })

  // The roster row is where a reload's outcome is reported, because it is already the one thing the
  // settings page and the attention bell read. Written in place: the bridge holds `roster` by reference.
  const markFailed = (name: string, stage: 'init' | 'ready', error: string): void => {
    const row = roster.find((entry) => entry.name === name)
    if (!row) return
    row.state = 'failed'
    row.failedAt = Date.now()
    row.reason = error
    row.stage = stage
  }
  const markActive = (name: string): void => {
    const row = roster.find((entry) => entry.name === name)
    if (!row) return
    row.state = 'active'
    delete row.failedAt
    delete row.reason
    delete row.stage
  }
  const forget = (name: string): void => {
    const index = started.findIndex((plugin) => plugin.name === name)
    if (index >= 0) started.splice(index, 1)
    const position = enabled.indexOf(name)
    if (position >= 0) enabled.splice(position, 1)
    contexts.delete(name)
  }

  const reload = async (name: string, next: PluginReloadRequest): Promise<PluginReloadOutcome> => {
    // Loaded plugins only, and this map is the one flag that says so (see PluginHostOptions.loaded). A
    // plugin whose init was CONTAINED at boot is still in it, which is what makes "write broken code,
    // reload, fix it, reload again" the normal path rather than a special case.
    if (!loadedBindings.has(name)) {
      return { ok: false, error: `'${name}' is not a plugin this node loaded from disk, so it cannot be reloaded. Built-ins need a restart.` }
    }
    if (disabled.has(name)) return { ok: false, error: `'${name}' is turned off on this node.` }

    // Everything the candidate registers is buffered here rather than written to the registries the
    // previous instance is still in (server/plugin/context.ts § pending). Its database is the one thing
    // it opens for real — and that is the recorded ceiling: registration rollback and SCHEMA rollback are
    // different promises, and only the first is made (main/pluginStorage.ts § Reload).
    const pending: (() => void)[] = []
    const candidateWsUndos: (() => void)[] = []
    // A box rather than a `let`, because every write happens inside the closure below and the failure
    // paths would otherwise be narrowed to `null` by control flow that cannot see them.
    const candidate: { db: PluginDatabase | null; committed: boolean } = { db: null, committed: false }
    const candidateCtx = buildPluginContext({
      plugin: name,
      capabilities: options.capabilities,
      core: options.core,
      loaded: next.binding,
      storage: {
        open: () => {
          candidate.db ??= next.binding.storage.open()
          // Once committed, the handle belongs to the host's map so `dispose()` and the next reload can
          // close it; before that it is the candidate's alone, closed by the failure path below.
          if (candidate.committed) opened.set(name, candidate.db)
          return candidate.db
        },
      },
      onWsRegistration: (undo) => void candidateWsUndos.push(undo),
      pending,
    })

    try {
      await next.plugin.init(candidateCtx)
    } catch (error) {
      // Nothing to roll back. The buffer was never replayed, so the previous instance is still registered
      // and still serving; the candidate's database handle is the only thing it really opened.
      try {
        candidate.db?.close()
      } catch {
        // Already closed by a dispose the failing init got far enough to arrange.
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[plugin:${name}] reload init failed; the previous instance is still serving:`, error)
      markFailed(name, 'init', message)
      return { ok: false, error: message }
    }

    // ── Commit ──────────────────────────────────────────────────────────────────────────────────────
    // Order matters: stop serving through the previous instance BEFORE its dispose runs, close its
    // database only AFTER (agents flushes, workflows aborts and database drains through that handle), and
    // revoke its context last so a leaked reference fails loudly from here on.
    clearRegistrations(name)
    const previous = started.find((plugin) => plugin.name === name)
    if (previous) {
      try {
        await previous.dispose?.()
      } catch (error) {
        console.warn(`[plugin:${name}] dispose during reload failed:`, error)
      }
    }
    closeStorage(name)
    const previousCtx = contexts.get(name)
    if (previousCtx) revokePluginContext(previousCtx)

    candidate.committed = true
    try {
      for (const apply of pending) apply()
    } catch (error) {
      // A registration that is INVALID — two tools sharing a name, a provider that fails its shape check —
      // can only be found here, because the registries are what validate it and the candidate never
      // touched them. The plugin ends up unregistered and marked failed, exactly like a contained boot
      // failure; what candidate-then-commit protects is init THROWING, which is the failure a dev loop
      // actually produces. Narrowing this window further would mean a validate-only pass in six
      // registries, which is a lot of surface to keep honest for a bundle that is broken either way.
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[plugin:${name}] reload could not register the new instance's contributions:`, error)
      clearRegistrations(name)
      for (const undo of candidateWsUndos.reverse()) undo()
      closeStorage(name)
      try {
        candidate.db?.close()
      } catch {
        // closeStorage already got it when the candidate's handle had reached the map.
      }
      forget(name)
      markFailed(name, 'init', message)
      return { ok: false, error: message }
    }

    const index = started.findIndex((plugin) => plugin.name === name)
    if (index >= 0) started[index] = next.plugin
    else started.push(next.plugin)
    if (!enabled.includes(name)) enabled.push(name)
    contexts.set(name, candidateCtx)
    loadedBindings.set(name, next.binding)
    if (candidate.db) opened.set(name, candidate.db)

    if (next.plugin.ready) {
      try {
        await next.plugin.ready(candidateCtx)
      } catch (error) {
        // Contained exactly as a ready failure at boot is, through the same rollback.
        await contain(next.plugin, 'ready', error)
        forget(name)
        markFailed(name, 'ready', error instanceof Error ? error.message : String(error))
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    markActive(name)
    return { ok: true }
  }

  return { enabled, skipped, failed, roster, reload, dispose: () => disposeStarted(started, closeStorage) }
}

// Everything one plugin contributed to the module-singleton registries, undone.
//
// Exported for one reason beyond the two paths below: a TEST that inits a plugin against a real context
// (testkit/pluginContext.ts) leaves the same registrations behind, in the same process-wide registries,
// and the next test file's init would hit a duplicate guard. Its cleanup() calls this, so the rollback a
// test gets is the host's rather than an approximation of it.
//
// Called on two paths. At boot it is idempotency: a second startServiceRuntime in one process must
// REPLACE a plugin's contributions rather than append copies bound to the first boot's (now closed)
// database — for routes that silently served every request from a closed handle; for tools it threw
// on the duplicate name and failed the whole boot. On a contained failure it is the rollback: a
// plugin that registered three routes and then threw must not leave those three routes serving.
export function clearRegistrations(name: string): void {
  removePluginRoutes(name)
  // The WS hub's two module-singleton slots have no duplicate guard, so a stale handler — closed
  // over an already-disposed engine — would keep claiming the prefix silently.
  for (const undo of wsRegistrations.get(name) ?? []) undo()
  wsRegistrations.delete(name)
  removeAgentTools(name)
  removeContextSections(name)
  // Model adapters first: an adapter is validated against a registered connection provider, so
  // removing the provider first would strand it.
  modelProviderRegistry.removeForPlugin(name)
  integrationProviderRegistry.removeForPlugin(name)
  connectionProviderRegistry.removeForPlugin(name)
}

// Reverse order, because a later plugin may depend on an earlier one's resources. Never rejects: one
// plugin failing to close must not strand the rest with an open WAL file, and teardown is already
// best-effort everywhere else.
//
// Each plugin's storage is closed immediately after its own dispose rather than in a second sweep at the
// end. That keeps the moment each WAL file drains exactly where it was when the plugins closed their own
// handles — inside the caller's `plugins` drain step, before `sqlite` and before the data-root lock
// (apps/node/src/server/composition.ts § NODE_DRAIN_ORDER) — and it holds even when an earlier plugin's
// dispose hangs long enough to hit the drain deadline.
async function disposeStarted(started: readonly NodePlugin[], closeStorage: (name: string) => void): Promise<void> {
  for (const plugin of [...started].reverse()) {
    try {
      await plugin.dispose?.()
    } catch (error) {
      console.warn(`[plugin:${plugin.name}] dispose failed:`, error)
    }
    closeStorage(plugin.name)
  }
}
