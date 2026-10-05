// The plugin host: builds every plugin's context in declaration order, then runs all of their inits at
// once. See docs/plugins/activation.md § Activation and § Loaded plugins.
//
// Declaration order must not be load-bearing, because a disabled plugin removes a step from the
// sequence and because the inits now overlap. Cross-plugin needs resolve through the capability
// registry at call time, and a plugin that has to read another plugin's contributions does it in
// `ready`, which runs after every init.
import type { Env } from '../bindings'
import type { CompiledCoreServices } from '../core'
import { builtinPluginStorage, type PluginDatabase } from '../plugins/storage'
import { removeAgentTools } from '../agentTools/registry'
import { removeContextSections } from '../agentTools/contextSections'
import { removePluginRoutes } from '../routes/registry'
import { connectionProviderRegistry } from '../integrations/connectionProviders/registry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import type { CapabilityRegistry } from './capabilities'
import { buildPluginContext, revokePluginContext, type LoadedPluginBinding } from './context'
import { clearDataSources } from '../dataSources/registry'
import { clearNodeActions } from '../nodeActions'
import { clearNodeProviders } from '../nodeProviders/registry'
import { clearRunSources } from '../runs/registry'
import { clearExtensionPoints } from './extensionPoints'
import { clearAuditActions } from '../audit'
import { disposeUnstartedPlugin } from '../plugins/isolation'
import { clearHooks } from './hooks'
import type { PluginEmit } from '@acorn/protocol/plugin/contract.ts'
import { clearTaskChecks } from './taskChecks'
import { clearSearchProviders } from './search'
import { declareEmits } from './emits'
import type { HostPluginContext, NodePlugin, PluginStorage } from './types'
import { createLogger, describeError } from '../telemetry/logger'
import { clearTelemetrySinks } from '../telemetry/collector'
import { registerManifestRuntimeContributions } from './runtimeContributions'
import { registerManifestSchedules, registerManifestTaskChecks, registerManifestHooks } from './manifestWork'
import { registerManifestHarnesses, registerManifestCustomAgents } from './manifestAgents'
import { registerManifestDataSources, registerManifestNodeActions, registerManifestAuditActions } from './manifestCatalog'

// One logger per plugin, minted where the name is known, so a line still reads `[plugin:<id>] …`.
const pluginLog = (name: string) => createLogger(`plugin:${name}`, name)

// Undos for what `clearRegistrations` can't reach on its own: the WS hub's two slots, which are module
// singletons with no duplicate guard, and schedules, which live in the composition root's scheduler.
const undoRegistrations = new Map<string, (() => void)[]>()

// Re-exported so the loader and the composition root can import it from here. The context shape it
// feeds lives in context.ts.
export type { LoadedPluginBinding }

export type PluginHostOptions = {
  // Owned by the caller. capabilities.ts says why these aren't module singletons.
  capabilities: CapabilityRegistry
  core: CompiledCoreServices
  // The node's data root, because the host opens the per-plugin SQLite files under it
  // (server/plugins/storage.ts). Required, because a caller that forgot it boots a graph whose plugins
  // silently find no `ctx.storage`.
  dataDir: string
  // Plugin ids the owner has turned off for this node. `required` plugins ignore it, because a node
  // without github, terminal or agents boots and then fails at the first task.
  disabled?: readonly string[]
  // The plugins that came off disk, keyed by name. Membership is the one flag separating a loaded
  // plugin from a built-in: contain its failures, and shape its context from the manifest. It lives in
  // the host's options rather than on NodePlugin, which a plugin's own bundle could set.
  loaded?: ReadonlyMap<string, LoadedPluginBinding>
  // The node's bindings, for the one thing the host does on a plugin's behalf: firing a
  // manifest-declared schedule, which calls one of that plugin's routes with no request in sight
  // (server/pluginHost/scheduleRun.ts). Optional because a suite that declares no schedule has nothing to
  // run. A binding that declares one without this is a wiring bug and throws.
  env?: Env
  // The composition root's boot timer, if it kept one. Both passes run before the listener binds, and a
  // single `install` label cannot say which plugin was the slow one, so there is a line per plugin per
  // pass. Read them as wall-clock slices rather than per-plugin costs once the passes overlap: a
  // plugin's line says when it finished.
  //
  // These are the marks that refused the 503-until-ready wire contract. Both passes together measure
  // 24 ms warm and 38 to 41 ms on a first boot against a realistic data root, out of a 132 ms boot,
  // which is not worth a code every client and the MCP child would honour forever
  // (apps/node/src/composition/runtime.ts § bootTimer).
  mark?: (label: string) => void
}

// One row per plugin the composition root offered, whether or not it ran. Settings → Plugins needs the
// whole list, including a checkbox for one the owner turned off, and which names are `required`.
export type PluginRosterEntry = {
  name: string
  // A compiled plugin's display name, from its definition. Absent for a loaded plugin, whose name
  // comes from its manifest (server/pluginHost/state.ts).
  label?: string
  emits?: readonly PluginEmit[]
  required: boolean
  disabled: boolean
  // What happened in this process. `disabled` above is what the owner asked for, this is the outcome.
  // Only a loaded plugin can reach 'failed'.
  state: 'active' | 'failed' | 'disabled'
  // When it failed, so the client's attention item can say how long it has been broken.
  failedAt?: number
  // What it threw, verbatim, for the owner to read. Plugin-authored text on its way to the owner's UI:
  // display-only, rendered as text and capped at the wire boundary (server/pluginHost/state.ts).
  reason?: string
  // Which pass it died in. 'load' never comes from the host, because that is the loader's failure
  // folded in one layer up, but the client renders all three from one field.
  stage?: 'load' | 'init' | 'ready'
}

export type PluginFailure = { name: string; error: string; at: number; stage: 'init' | 'ready' }

// The new instance, as the caller took it off disk. The host does no filesystem work: the loader owns
// importing a bundle and confining its migrations chain (server/plugins/reload.ts drives both).
export type PluginReloadRequest = { plugin: NodePlugin; binding: LoadedPluginBinding }
export type PluginReloadOutcome = { ok: true } | { ok: false; error: string; retained?: boolean }

export type PluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
  // Loaded plugins whose init or ready threw. Their registrations were rolled back and boot continued.
  // Built-ins are never here, because a built-in throwing fails the boot.
  failed: readonly PluginFailure[]
  // Mutable in place: `reload` below changes a row's outcome in a running process, and the PLUGIN_STATE
  // bridge holds this array by reference.
  roster: readonly PluginRosterEntry[]
  /** Swap one loaded plugin's node half in a running process, candidate-then-commit.
   * See docs/plugins/dev-loop.md § The dev loop.
   *
   * The candidate's `init` runs against a buffered registration set (server/pluginHost/context.ts §
   * pending), so a throw leaves the previous instance registered, serving and holding its database. */
  reload(name: string, next: PluginReloadRequest): Promise<PluginReloadOutcome>
  // Release every initialized plugin, newest first, and close the `ctx.storage` database each one
  // opened, before the data root lock drops. Never rejects: one plugin failing to close must not stop
  // the rest.
  dispose(): Promise<void>
}

export async function initPlugins(plugins: readonly NodePlugin[], options: PluginHostOptions): Promise<PluginHostResult> {
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) throw new Error(`Duplicate node plugin: ${plugin.name}`)
    seen.add(plugin.name)
  }
  const mark = options.mark ?? (() => {})
  const disabled = new Set(options.disabled ?? [])
  const enabled: string[] = []
  const skipped: string[] = []
  const failed: PluginFailure[] = []
  const started: NodePlugin[] = []
  // Kept so the ready pass below hands each plugin the same context its init got.
  const contexts = new Map<string, HostPluginContext>()
  // Seeded from the boot options and replaced by a successful reload, so after a swap the running
  // instance takes its permissions and migrations chain from the fresh manifest. Membership also
  // answers "may this name be reloaded at all".
  const loadedBindings = new Map(options.loaded ?? [])
  // A missing env is a composition-root wiring bug, not a plugin's fault, so it is raised here, before
  // anything starts and there is a graph to unwind.
  const requireEnv = (name: string): Env => {
    if (!options.env) throw new Error(`Plugin '${name}' declares work the node runs on its own, but initPlugins was given no env to run it with.`)
    return options.env
  }
  for (const [name, binding] of loadedBindings) if (binding.schedules?.length) requireEnv(name)

  // Every database handed out through `ctx.storage`, so the host can close what it opened. Per call,
  // not a module singleton: a second startServiceRuntime in one process gets its own handles.
  //
  // Memoized per plugin, which plugins can see: one connection per plugin per boot, however many times
  // open() is called.
  const opened = new Map<string, PluginDatabase>()
  const storageFor = (plugin: NodePlugin, loaded?: LoadedPluginBinding): PluginStorage | undefined => {
    // The loaded binding first and unconditionally (server/pluginHost/context.ts says why).
    // `migrationsModule` is the compiled tier's declaration, read only for a plugin that isn't loaded.
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
  // Called after a plugin's own dispose, never before: agents flushes its transcript, workflows aborts
  // live steps and database drains its pools through this handle. Closing it first turns a clean
  // shutdown into writes on a dead connection.
  const closeStorage = (name: string): void => {
    const db = opened.get(name)
    if (!db) return
    opened.delete(name)
    try {
      db.close()
    } catch {
      // An older loaded bundle may close its own handle in dispose, and node:sqlite refuses a second
      // close. Nothing to report: the file drains either way.
    }
  }

  // The host owns this undo alongside context registrations; declarations follow the binding
  // generation and are removed with that instance.
  const registerEmits = (plugin: NodePlugin, binding: LoadedPluginBinding | undefined, onUndo: (undo: () => void) => void): void => {
    onUndo(declareEmits(plugin.name, binding ? (binding.emits ?? []) : (plugin.emits ?? [])))
  }

  // Roll a contained plugin back to its pre-init state: undo everything it registered, let it release
  // what it opened, and record why. Boot continues, which is the difference between "one installed
  // plugin is broken" and "this node does not start".
  const contain = async (plugin: NodePlugin, ctx: ReturnType<typeof buildPluginContext>, phase: 'init' | 'ready', error: unknown): Promise<void> => {
    pluginLog(plugin.name).error(`${phase} failed; the plugin is disabled for this boot: ${describeError(error).message}`)
    clearRegistrations(plugin.name)
    try {
      await plugin.dispose?.()
    } catch (disposeError) {
      pluginLog(plugin.name).warn(`dispose after a failed ${phase} also failed: ${describeError(disposeError).message}`)
    }
    // Including the database it opened before it threw. A contained failure that left a WAL handle on
    // the data root is the lock leak initPlugins' dispose contract exists to prevent.
    closeStorage(plugin.name)
    revokePluginContext(ctx)
    contexts.delete(plugin.name)
    failed.push({ name: plugin.name, error: error instanceof Error ? error.message : String(error), at: Date.now(), stage: phase })
  }

  // Every plugin that is going to run, prepared in declaration order, before any of them starts. The
  // registrations here are synchronous and independent, so doing them all first is what lets the init
  // pass below be concurrent without a plugin racing a neighbour's manifest declarations.
  const running: { plugin: NodePlugin; ctx: ReturnType<typeof buildPluginContext>; loaded: LoadedPluginBinding | undefined }[] = []
  try {
    for (const plugin of plugins) {
      // Clearing happens before the disabled check. These registries are module singletons, so a
      // disabled plugin on a later boot cannot keep closures over its previous, closed database.
      clearRegistrations(plugin.name)
      if (disabled.has(plugin.name) && !plugin.required) {
        if (options.loaded?.has(plugin.name)) await disposeUnstartedPlugin(plugin)
        skipped.push(plugin.name)
        continue
      }
      const loaded = options.loaded?.get(plugin.name)
      const storage = storageFor(plugin, loaded)
      const ctx = buildPluginContext({
        plugin: plugin.name,
        capabilities: options.capabilities,
        core: options.core,
        env: options.env,
        loaded,
        ...(storage ? { storage } : {}),
        onUndo: (undo) => undoRegistrations.set(plugin.name, [...(undoRegistrations.get(plugin.name) ?? []), undo]),
      })
      // Add the context before the first registration: any later adapter may throw after an earlier
      // descriptor registered, and the catch below must take that partial manifest back.
      running.push({ plugin, ctx, loaded })
      try {
        registerEmits(plugin, loaded, (undo) => undoRegistrations.set(plugin.name, [...(undoRegistrations.get(plugin.name) ?? []), undo]))
        registerManifestSchedules(ctx, plugin.name, loaded, requireEnv)
        registerManifestTaskChecks(ctx, plugin.name, loaded, requireEnv)
        registerManifestHooks(ctx, plugin.name, loaded, requireEnv)
        registerManifestDataSources(ctx, loaded)
        registerManifestNodeActions(ctx, loaded)
        registerManifestAuditActions(ctx, loaded)
        registerManifestRuntimeContributions(ctx, plugin.name, loaded, requireEnv)
      } catch (error) {
        if (!loaded) throw error
        await contain(plugin, ctx, 'init', error)
        running.pop()
      }
    }
  } catch (error) {
    for (const { plugin, ctx, loaded } of [...running].reverse()) {
      clearRegistrations(plugin.name)
      closeStorage(plugin.name)
      revokePluginContext(ctx)
      if (loaded) await disposeUnstartedPlugin(plugin)
    }
    throw error
  }

  // The init pass, all at once. Nothing here consumes another plugin's contributions, which is what
  // `ready` below is for, so the serial loop was serial because loops are.
  //
  // Do not expect this to be faster. Most of these inits are synchronous: `ctx.storage.open()` opens a
  // node:sqlite handle and runs drizzle's migration chain without awaiting anything, so one thread runs
  // them one after another either way, and the measured pass is 24 ms warm before and after
  // (measured 2026-09-03). What this buys is that a plugin
  // that does await something no longer holds up its neighbours.
  //
  // `allSettled` rather than `all`, because the failure handling per plugin is the same as the serial
  // loop's `catch` and one plugin throwing must not hide what its neighbours did.
  const inits = await Promise.allSettled(
    running.map(async ({ plugin, ctx }) => {
      await plugin.init(ctx)
      mark(`plugin ${plugin.name} init`)
    }),
  )

  // Sorted in declaration order, not completion order, so `started` and `enabled` read the same on
  // every boot. `started` reversed is the dispose order, and a later plugin may depend on an earlier
  // one's resources, which is the reason that order is declaration and not "whoever finished last".
  //
  // A built-in failing still fails the boot, because every built-in is first-party code in the same
  // binary. The difference from the serial loop is that its neighbours have already run, so all of
  // them are torn down rather than the prefix: each holds a WAL-mode SQLite handle and the composition
  // root's catch releases the data-root lock. A loaded plugin is contained instead
  // (docs/plugins/loaded-plugins.md § Loaded plugins).
  let fatal: { error: unknown } | null = null
  for (const [index, outcome] of inits.entries()) {
    const { plugin, ctx, loaded } = running[index]
    if (outcome.status === 'fulfilled') {
      contexts.set(plugin.name, ctx)
      started.push(plugin)
      enabled.push(plugin.name)
      continue
    }
    if (loaded?.permissions) {
      await contain(plugin, ctx, 'init', outcome.reason)
      continue
    }
    fatal ??= { error: outcome.reason }
  }
  if (fatal) {
    // A failed compiled init may already own a database, route, capability or process. Every init
    // settled, so dispose every non-contained instance, including the one that threw.
    await disposeStarted(running.filter(({ plugin }) => !failed.some((entry) => entry.name === plugin.name)).map(({ plugin }) => plugin), closeStorage, contexts)
    for (const { ctx } of running) revokePluginContext(ctx)
    throw fatal.error
  }

  // The one manifest contribution that lands in another plugin's registry, so the one that cannot be
  // declared before the init pass: `ctx.harnesses.register` resolves AGENTS_HARNESS_REGISTRY at
  // registration time, and the agents plugin provides it in its own init
  // (server/pluginHost/context.ts § harnesses). Declared here it no longer matters which order the
  // roster puts the two in; declared before init it silently registered nothing whenever agents had
  // not run yet.
  for (const { plugin, ctx, loaded } of running) {
    if (!started.includes(plugin)) continue
    try {
      registerManifestHarnesses(ctx, plugin.name, loaded, requireEnv)
      registerManifestCustomAgents(ctx, plugin.name, loaded)
    } catch (error) {
      if (!loaded) {
        await disposeStarted(started, closeStorage, contexts)
        throw error
      }
      await contain(plugin, ctx, 'init', error)
      started.splice(started.indexOf(plugin), 1)
      enabled.splice(enabled.indexOf(plugin.name), 1)
    }
  }

  // The second pass, after every init: a plugin that must read another plugin's contributions runs here
  // rather than depending on its position in the list. Concurrent for the same reason the init pass is,
  // and still before the listener binds. Snapshotted, because containing a failure below removes the
  // plugin from `started`.
  const readying = [...started]
  const readies = await Promise.allSettled(
    readying.map(async (plugin) => {
      if (!plugin.ready) return
      await plugin.ready(contexts.get(plugin.name)!)
      mark(`plugin ${plugin.name} ready`)
    }),
  )
  for (const [index, outcome] of readies.entries()) {
    if (outcome.status === 'fulfilled') continue
    const plugin = readying[index]
    if (options.loaded?.has(plugin.name)) {
      await contain(plugin, contexts.get(plugin.name)!, 'ready', outcome.reason)
      // Out of both lists: `contain` already disposed it, and leaving it in `started` would dispose it
      // again at shutdown.
      started.splice(started.indexOf(plugin), 1)
      enabled.splice(enabled.indexOf(plugin.name), 1)
      continue
    }
    fatal ??= { error: outcome.reason }
  }
  if (fatal) {
    await disposeStarted(started, closeStorage, contexts)
    throw fatal.error
  }

  // Built from the offered list, in declaration order, so a skipped plugin still has a row. `disabled`
  // reports what the owner asked for, not what the host did: a required plugin named in the list reads
  // `{ required: true, disabled: false }`, because it is running and the UI must not offer to stop it.
  const failures = new Map(failed.map((entry) => [entry.name, entry]))
  const roster = plugins.map((plugin): PluginRosterEntry => {
    const isDisabled = disabled.has(plugin.name) && plugin.required !== true
    const failure = failures.get(plugin.name)
    return {
      name: plugin.name,
      ...(plugin.label ? { label: plugin.label } : {}),
      ...(plugin.emits?.length ? { emits: plugin.emits } : {}),
      required: plugin.required === true,
      disabled: isDisabled,
      // A failure outranks the disabled flag only because the two cannot co-occur: a disabled plugin
      // never ran, so it never failed.
      state: failure ? 'failed' : isDisabled ? 'disabled' : 'active',
      ...(failure ? { failedAt: failure.at, reason: failure.error, stage: failure.stage } : {}),
    }
  })

  // The roster row is where a reload's outcome is reported, because the settings page and the attention
  // bell already read it. Written in place: the bridge holds `roster` by reference.
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
    // Loaded plugins only, and this map is the flag that says so. A plugin whose init was contained at
    // boot is still in it, which makes "write broken code, reload, fix it, reload again" work.
    if (!loadedBindings.has(name)) {
      await disposeUnstartedPlugin(next.plugin)
      return { ok: false, error: `'${name}' is not a plugin this node loaded from disk, so it cannot be reloaded. Built-ins need a restart.` }
    }
    if (disabled.has(name)) {
      await disposeUnstartedPlugin(next.plugin)
      return { ok: false, error: `'${name}' is turned off on this node.` }
    }

    // Everything the candidate registers is buffered rather than written to the registries the previous
    // instance is still in (server/pluginHost/context.ts § pending). Its database is the one thing it opens
    // for real, and that is the recorded ceiling: only registration rollback is promised, not schema
    // rollback (server/plugins/storage.ts § Reload).
    const pending: (() => void)[] = []
    const candidateUndos: (() => void)[] = []
    // A box rather than a `let`, because every write happens inside the closure below and the failure
    // paths would otherwise be narrowed to `null` by control flow that cannot see them.
    const candidate: { db: PluginDatabase | null; committed: boolean } = { db: null, committed: false }
    const candidateCtx = buildPluginContext({
      plugin: name,
      capabilities: options.capabilities,
      core: options.core,
      env: options.env,
      loaded: next.binding,
      storage: {
        open: () => {
          candidate.db ??= next.binding.storage.open()
          // Once committed the handle belongs to the host's map, so `dispose()` and the next reload can
          // close it. Before that it is the candidate's alone, closed by the failure path below.
          if (candidate.committed) opened.set(name, candidate.db)
          return candidate.db
        },
      },
      onUndo: (undo) => void candidateUndos.push(undo),
      pending,
    })

    let candidateStage: 'init' | 'ready' = 'init'
    try {
      // Buffered like everything else: the previous instance's schedules are still on the scheduler
      // under the same keys, and registering now throws on the duplicate.
      registerManifestSchedules(candidateCtx, name, next.binding, requireEnv)
      registerManifestTaskChecks(candidateCtx, name, next.binding, requireEnv)
      registerManifestHooks(candidateCtx, name, next.binding, requireEnv)
      registerManifestHarnesses(candidateCtx, name, next.binding, requireEnv)
      registerManifestCustomAgents(candidateCtx, name, next.binding)
      registerManifestDataSources(candidateCtx, next.binding)
      registerManifestNodeActions(candidateCtx, next.binding)
      registerManifestAuditActions(candidateCtx, next.binding)
      registerManifestRuntimeContributions(candidateCtx, name, next.binding, requireEnv)
      await next.plugin.init(candidateCtx)
      // Ready belongs to the candidate window too. If it throws after the old instance is disposed,
      // the host can no longer truthfully report that the old runtime is still active.
      candidateStage = 'ready'
      await next.plugin.ready?.(candidateCtx)
    } catch (error) {
      // Nothing to roll back. The buffer was never replayed, so the previous instance is still serving,
      // and the candidate's database handle is the only thing it opened.
      try {
        await next.plugin.dispose?.()
      } catch {
        // The init failure is the useful error. A broken candidate's cleanup must not replace it.
      }
      try {
        candidate.db?.close()
      } catch {
        // Already closed by a dispose the failing init got far enough to arrange.
      }
      revokePluginContext(candidateCtx)
      const message = error instanceof Error ? error.message : String(error)
      pluginLog(name).error(`reload ${candidateStage} failed; the previous instance is still serving: ${describeError(error).message}`)
      markFailed(name, candidateStage, message)
      return { ok: false, error: message, retained: true }
    }

    // ── Commit ─────────────────────────────────────────────────────────────────────────────────────
    // Order matters: stop serving through the previous instance before its dispose runs, close its
    // database only after (agents flushes, workflows aborts and database drains through that handle),
    // and revoke its context last so a leaked reference fails loudly.
    clearRegistrations(name)
    registerEmits(next.plugin, next.binding, (undo) => void candidateUndos.push(undo))
    const previous = started.find((plugin) => plugin.name === name)
    if (previous) {
      try {
        await previous.dispose?.()
      } catch (error) {
        pluginLog(name).warn(`dispose during reload failed: ${describeError(error).message}`)
      }
    }
    closeStorage(name)
    const previousCtx = contexts.get(name)
    if (previousCtx) revokePluginContext(previousCtx)

    candidate.committed = true
    try {
      for (const apply of pending) apply()
    } catch (error) {
      // An invalid registration, such as two tools sharing a name, can only surface here, because the
      // registries validate it and the candidate never touched them. The plugin ends up unregistered
      // and marked failed, like a contained boot failure. Candidate-then-commit protects against init
      // throwing, the failure a dev loop produces. Narrowing this window further would mean a
      // validate-only pass in six registries.
      const message = error instanceof Error ? error.message : String(error)
      pluginLog(name).error(`reload could not register the new instance's contributions: ${describeError(error).message}`)
      clearRegistrations(name)
      for (const undo of candidateUndos.reverse()) undo()
      try {
        await next.plugin.dispose?.()
      } catch {
        // Preserve the registration error when candidate cleanup also fails.
      }
      closeStorage(name)
      try {
        candidate.db?.close()
      } catch {
        // closeStorage already got it, once the candidate's handle had reached the map.
      }
      revokePluginContext(candidateCtx)
      forget(name)
      markFailed(name, 'init', message)
      return { ok: false, error: message, retained: false }
    }

    // The committed instance's undos become the host's, or the next reload's clearRegistrations has
    // nothing to take back and the scheduler refuses its own plugin's key as a duplicate.
    // `clearRegistrations` above already dropped the previous instance's entry, so this is a set.
    if (candidateUndos.length) undoRegistrations.set(name, [...candidateUndos])

    const index = started.findIndex((plugin) => plugin.name === name)
    if (index >= 0) started[index] = next.plugin
    else started.push(next.plugin)
    if (!enabled.includes(name)) enabled.push(name)
    contexts.set(name, candidateCtx)
    loadedBindings.set(name, next.binding)
    const rosterRow = roster.find((entry) => entry.name === name)
    if (rosterRow) {
      if (next.plugin.emits?.length) rosterRow.emits = next.plugin.emits
      else delete rosterRow.emits
    }
    if (candidate.db) opened.set(name, candidate.db)

    markActive(name)
    return { ok: true }
  }

  return { enabled, skipped, failed, roster, reload, dispose: () => disposeStarted(started, closeStorage, contexts) }
}

// Everything one plugin contributed to the module-singleton registries, undone.
//
// Called on two paths. At boot it is idempotency: a second startServiceRuntime in one process must
// replace a plugin's contributions rather than append copies bound to the first boot's closed database.
// On a contained failure it is the rollback.
//
// Exported for tests too: a test that inits a plugin against a real context leaves the same
// registrations in the same process-wide registries, and its cleanup() calls this.
export function clearRegistrations(name: string): void {
  removePluginRoutes(name)
  // A sink is a closure over the instance being rolled back, and the collector holds it by
  // reference on a timer, so a survivor would keep feeding a disposed plugin every record this node
  // collects (../telemetry/collector.ts).
  clearTelemetrySinks(name)
  // The WS hub's two module-singleton slots have no duplicate guard, so a stale handler closed over a
  // disposed engine keeps claiming the prefix silently.
  for (const undo of [...(undoRegistrations.get(name) ?? [])].reverse()) undo()
  undoRegistrations.delete(name)
  removeAgentTools(name)
  clearDataSources(name)
  clearNodeActions(name)
  // A run source is a pointer at a route this call just removed, same as a data-source read.
  clearRunSources(name)
  // The declarations go; the rows they describe stay. A verb whose plugin is gone renders as its raw
  // qualified string in the settings list, which is the honest answer — the row is still evidence of
  // something that happened.
  clearAuditActions(name)
  // Both halves of the node's many-to-many seam: the points this plugin opened and the entries it
  // filed into other plugins' points (./extensionPoints.ts).
  clearExtensionPoints(name)
  clearHooks(name)
  // A task check is a live closure over this plugin's context, asked at archive time, long after a
  // re-init has replaced the instance behind it.
  clearTaskChecks(name)
  clearSearchProviders(name)
  removeContextSections(name)
  // Model adapters first: an adapter is validated against a registered connection provider, so removing
  // the provider first strands it.
  modelProviderRegistry.removeForPlugin(name)
  integrationProviderRegistry.removeForPlugin(name)
  connectionProviderRegistry.removeForPlugin(name)
  // A node provider holds a closure over this plugin's context and, for a cloud one, its credential
  // scope. A survivor would keep listing nodes through an instance whose dispose has already run.
  clearNodeProviders(name)
}

// Reverse order, because a later plugin may depend on an earlier one's resources. Never rejects: one
// plugin failing to close must not strand the rest with an open WAL file.
//
// Each plugin's storage closes right after its own dispose rather than in a second sweep, so each WAL
// file drains inside the caller's `plugins` drain step, before `sqlite` and before the data-root lock
// (apps/node/src/server/composition.ts § NODE_DRAIN_ORDER).
async function disposeStarted(
  started: readonly NodePlugin[],
  closeStorage: (name: string) => void,
  contexts: Map<string, HostPluginContext>,
): Promise<void> {
  for (const plugin of [...started].reverse()) {
    try {
      await plugin.dispose?.()
    } catch (error) {
      pluginLog(plugin.name).warn(`dispose failed: ${describeError(error).message}`)
    }
    closeStorage(plugin.name)
    // A host can be stopped and started again in one process (tests do this, and supervised reload may
    // eventually do the same). Teardown must revoke every live registry closure, not rely on process exit.
    clearRegistrations(plugin.name)
    const ctx = contexts.get(plugin.name)
    if (ctx) revokePluginContext(ctx)
    contexts.delete(plugin.name)
  }
}
