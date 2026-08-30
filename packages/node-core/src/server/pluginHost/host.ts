// The plugin host: builds each plugin's context and runs its init, in declaration order.
// See docs/plugins.md § Activation and § Loaded plugins.
//
// Declaration order must not be load-bearing, because a disabled plugin removes a step from the
// sequence. Cross-plugin needs resolve through the capability registry at call time.
import type { Env } from '../bindings'
import type { CoreServices } from '../core'
import { builtinPluginStorage, type PluginDatabase } from '../plugins/storage'
import { removeAgentTools } from '../agentTools/registry'
import { removeContextSections } from '../agentTools/contextSections'
import { removePluginRoutes } from '../routeRegistry'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import type { CapabilityRegistry } from './capabilities'
import { buildPluginContext, revokePluginContext, type LoadedPluginBinding } from './context'
import { clearCollectionReads } from '../collections/registry'
import { clearNodeActions } from '../nodeActions'
import { clearNodeProviders } from '../nodeProviders/registry'
import { clearRunSources } from '../runs/registry'
import { clearExtensionPoints } from './extensionPoints'
import { clearAuditActions } from '../audit'
import { resolveInRoot } from '../core/fs'
import { dispatchPluginRoute } from './dispatch'
import type { ManifestHarnessSpawn } from './harnesses'
import { runPluginScheduleRoute } from './scheduleRun'
import { runPluginTaskApply, runPluginTaskCheck } from './taskCheckRun'
import { clearHooks, isHookMode } from './hooks'
import type { HookMode } from '@acorn/protocol/extensionPoints.ts'
import { runPluginHookRoute } from './hookRun'
import { clearTaskChecks } from './taskChecks'
import { declareEmits } from './emits'
import type { HostPluginContext, NodePlugin, NodePluginContext, PluginHookPoint, PluginStorage } from './types'

// Undos for what `clearRegistrations` can't reach on its own: the WS hub's two slots, which are module
// singletons with no duplicate guard, and schedules, which live in the composition root's scheduler.
const undoRegistrations = new Map<string, (() => void)[]>()

// Re-exported so the loader and the composition root can import it from here. The context shape it
// feeds lives in context.ts.
export type { LoadedPluginBinding }

export type PluginHostOptions = {
  // Owned by the caller. capabilities.ts says why these aren't module singletons.
  capabilities: CapabilityRegistry
  core: CoreServices
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
}

// One row per plugin the composition root offered, whether or not it ran. Settings → Plugins needs the
// whole list, including a checkbox for one the owner turned off, and which names are `required`.
export type PluginRosterEntry = {
  name: string
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
export type PluginReloadOutcome = { ok: true } | { ok: false; error: string }

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
   * See docs/plugins.md § The dev loop.
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
  const disabled = new Set(options.disabled ?? [])
  const enabled: string[] = []
  const skipped: string[] = []
  const failed: PluginFailure[] = []
  const started: NodePlugin[] = []
  // Kept so the ready pass below hands each plugin the same context its init got.
  const contexts = new Map<string, NodePluginContext>()
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

  // What a loaded plugin's manifest declared as periodic work, put on the node's scheduler through the
  // same `ctx.schedules` seam a built-in uses, so the lifecycle, the reload buffering and the undo come
  // from the context.
  //
  // Registered before init: the runner resolves the plugin's route when the schedule fires, so ordering
  // against the plugin's own route registration does not matter.
  // What other plugins may hear from this one (./emits.ts). The manifest's declaration for a loaded
  // plugin, the `NodePlugin.emits` field for a built-in, and the undo goes where every other
  // registration's does, so unload takes the declaration with it.
  const registerEmits = (plugin: NodePlugin, binding: LoadedPluginBinding | undefined, onUndo: (undo: () => void) => void): void => {
    onUndo(declareEmits(plugin.name, binding ? (binding.emits ?? []) : (plugin.emits ?? [])))
  }

  const registerManifestSchedules = (ctx: NodePluginContext, name: string, binding?: LoadedPluginBinding): void => {
    const declared = binding?.schedules ?? []
    if (declared.length === 0) return
    const env = requireEnv(name)
    for (const descriptor of declared) {
      ctx.schedules.register({
        scheduleId: descriptor.id,
        name: descriptor.name,
        cadence: descriptor.cadence,
        ...(descriptor.timeout === undefined ? {} : { timeout: descriptor.timeout }),
        run: (signal) => runPluginScheduleRoute(env, name, descriptor, signal),
      })
    }
  }

  // The same for archive checks (./taskChecks.ts), with one difference: a check is asked while a person
  // waits on a dialog. The env resolves eagerly here, so a package that declares a check on a node with
  // no bindings fails at boot with the plugin named, rather than once per archive.
  const registerManifestTaskChecks = (ctx: NodePluginContext, name: string, binding?: LoadedPluginBinding): void => {
    const declared = binding?.taskChecks ?? []
    if (declared.length === 0) return
    const env = requireEnv(name)
    for (const descriptor of declared) {
      ctx.taskChecks.register({
        id: descriptor.id,
        check: (task, signal) => runPluginTaskCheck(env, name, descriptor, task, signal),
        // Only when the manifest declared one. A check with no `apply` never draws a checkbox, the rule
        // sanitizeConcern enforces on the answer. Bound here so the two cannot disagree.
        ...(descriptor.apply === undefined
          ? {}
          : { apply: (task, signal) => runPluginTaskApply(env, name, descriptor.apply!, task, signal) }),
      })
    }
  }

  // Hooks, both halves (./hooks.ts). A manifest declares the points this package owns and the handlers
  // it registers on other packages', and this is where each becomes a registration.
  //
  // A handler's carrier is the difference between the two tiers and the only difference: `ctx.hooks.handle`
  // takes a function, and the closure built here calls a declared route instead. The env resolves
  // eagerly for the same reason a task check's does — a package declaring a handler on a node with no
  // bindings should fail at boot with the plugin named, not once per decision.
  const registerManifestHooks = (ctx: NodePluginContext, name: string, binding?: LoadedPluginBinding): void => {
    for (const point of binding?.extensionPoints ?? []) {
      if (point.kind !== 'hook' || !point.payload || !point.allows) continue
      ctx.hooks.declare({
        id: point.id,
        label: point.label,
        payload: point.payload as PluginHookPoint['payload'],
        // Narrowed here rather than believed: the wire projection widens `allows` to strings, because a
        // roster row is bytes a node sent.
        allows: point.allows.filter(isHookMode),
        timeoutMs: point.timeoutMs,
        onTimeout: point.onTimeout,
        ...(point.order === 'priority' || point.order === 'install' ? { order: point.order } : {}),
        collect: point.collect,
      })
    }
    const handlers = (binding?.extensions ?? []).filter((entry) => entry.route !== undefined && isHookMode(entry.mode))
    if (handlers.length === 0) return
    const env = requireEnv(name)
    for (const entry of handlers) {
      ctx.hooks.handle(entry.point, {
        id: entry.id,
        mode: entry.mode as HookMode,
        priority: entry.priority,
        run: (payload, signal) => runPluginHookRoute(env, name, entry.route!, payload, signal),
      })
    }
  }

  // The same for audit verbs (../audit.ts). Nothing to dispatch and no env needed: the declaration is
  // the whole contribution, and `ctx.audit.record` is refused for anything not in it.
  const registerManifestAuditActions = (ctx: NodePluginContext, binding?: LoadedPluginBinding): void => {
    for (const descriptor of binding?.auditActions ?? []) ctx.audit.declare(descriptor)
  }

  // The same for collections (../collections/registry.ts): a manifest declares an `items` route per
  // collection, and the node-side read registry maps `(pluginId, collectionId)` to it. No env needed,
  // because registering a pointer costs nothing.
  const registerManifestCollections = (ctx: NodePluginContext, binding?: LoadedPluginBinding): void => {
    for (const descriptor of binding?.collections ?? []) {
      ctx.collections.register({
        collectionId: descriptor.id,
        items: descriptor.items,
        ...(descriptor.params ? { params: descriptor.params } : {}),
      })
    }
  }

  // What a loaded plugin's manifest declared as managed agent harnesses, handed on to whichever plugin
  // owns agent sessions (./harnesses.ts). Two things happen only here:
  //
  //   an adapter entry resolves against the plugin's installed package directory and is re-confined,
  //     so the consumer never touches the filesystem to find a path a manifest wrote;
  //   a probe route becomes a call, because the host is the only side that can dispatch one with no
  //     client in sight (./dispatch.ts, shared with schedules and checks).
  //
  // A descriptor whose entry escapes its package is dropped with a warning rather than failing the boot.
  // It is one harness of a package that may contribute other things.
  const registerManifestHarnesses = (ctx: HostPluginContext, name: string, binding?: LoadedPluginBinding): void => {
    const declared = binding?.harnesses ?? []
    if (declared.length === 0) return
    for (const descriptor of declared) {
      let spawn: ManifestHarnessSpawn
      if (descriptor.spawn.command !== undefined) {
        spawn = { command: descriptor.spawn.command, args: descriptor.spawn.args }
      } else {
        const resolved = binding?.dir ? resolveInRoot(binding.dir, descriptor.spawn.entry!) : null
        if (!resolved) {
          console.warn(`[plugin:${name}] harness '${descriptor.id}' declares an entry outside its package; skipped`)
          continue
        }
        spawn = {
          entry: resolved,
          args: descriptor.spawn.args,
          ...(descriptor.spawn.requires ? { requires: descriptor.spawn.requires } : {}),
        }
      }
      // Resolved lazily inside the probe, so a node with no bindings can still register a harness whose
      // transcript works. Only the probe has nothing to answer with.
      const probe = (path: string) => async (signal: AbortSignal): Promise<unknown> => {
        const response = await dispatchPluginRoute(requireEnv(name), name, path, { method: 'GET' }, signal)
        if (!response.ok) {
          console.warn(`[harness] ${name}:${descriptor.id} answered ${response.status} from ${path}`)
          return null
        }
        return await response.json().catch(() => null)
      }
      ctx.harnesses.register({
        id: descriptor.id,
        label: descriptor.label,
        ...(descriptor.glyph ? { glyph: descriptor.glyph } : {}),
        spawn,
        envPassthrough: descriptor.envPassthrough,
        quirks: descriptor.quirks,
        ...(descriptor.terminal ? { terminal: descriptor.terminal } : {}),
        ...(descriptor.probes?.usage ? { probeUsage: probe(descriptor.probes.usage) } : {}),
        ...(descriptor.probes?.auth ? { probeAuth: probe(descriptor.probes.auth) } : {}),
      })
    }
  }

  // A loaded plugin's schedulable actions, synthesised from the manifest's commands whose verb is
  // `runNodeAction`, the only verb that means anything with nobody watching.
  //
  // A command descriptor declares no tier, so `riskOf` pins these to `execute`, the strongest
  // confirmation. If the descriptor grows a `risk` field, this is the line that reads it.
  const registerManifestNodeActions = (ctx: HostPluginContext, binding?: LoadedPluginBinding): void => {
    for (const command of binding?.commands ?? []) {
      if (command.action.verb !== 'runNodeAction') continue
      ctx.nodeActions.register({ actionId: command.id, name: command.title, path: command.action.path })
    }
  }

  // Roll a contained plugin back to its pre-init state: undo everything it registered, let it release
  // what it opened, and record why. Boot continues, which is the difference between "one installed
  // plugin is broken" and "this node does not start".
  const contain = async (plugin: NodePlugin, phase: 'init' | 'ready', error: unknown): Promise<void> => {
    console.error(`[plugin:${plugin.name}] ${phase} failed; the plugin is disabled for this boot:`, error)
    clearRegistrations(plugin.name)
    try {
      await plugin.dispose?.()
    } catch (disposeError) {
      console.warn(`[plugin:${plugin.name}] dispose after a failed ${phase} also failed:`, disposeError)
    }
    // Including the database it opened before it threw. A contained failure that left a WAL handle on
    // the data root is the lock leak initPlugins' dispose contract exists to prevent.
    closeStorage(plugin.name)
    failed.push({ name: plugin.name, error: error instanceof Error ? error.message : String(error), at: Date.now(), stage: phase })
  }

  for (const plugin of plugins) {
    // Clearing happens before the disabled check. These registries are module singletons, so a plugin
    // disabled on the second boot of one process would otherwise keep the first boot's routes, tools
    // and providers, served through a database handle its dispose already closed.
    clearRegistrations(plugin.name)
    if (disabled.has(plugin.name) && !plugin.required) {
      skipped.push(plugin.name)
      continue
    }
    // Undefined for a built-in, the manifest's `permissions.node` block for a plugin loaded from disk.
    // Its presence is what shapes the context (server/pluginHost/context.ts).
    const loaded = options.loaded?.get(plugin.name)
    const permissions = loaded?.permissions
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
    registerEmits(plugin, loaded, (undo) => undoRegistrations.set(plugin.name, [...(undoRegistrations.get(plugin.name) ?? []), undo]))
    registerManifestSchedules(ctx, plugin.name, loaded)
    registerManifestTaskChecks(ctx, plugin.name, loaded)
    registerManifestHooks(ctx, plugin.name, loaded)
    registerManifestHarnesses(ctx, plugin.name, loaded)
    registerManifestCollections(ctx, loaded)
    registerManifestNodeActions(ctx, loaded)
    registerManifestAuditActions(ctx, loaded)
    // A failing init fails the boot, because every plugin here is first-party code in the same binary.
    // The plugins that already initialized are torn down first: each holds a WAL-mode SQLite handle and
    // the composition root's catch releases the data-root lock. The caller cannot do it, because it
    // only receives the dispose closure from a resolved result.
    //
    // A loaded plugin is contained instead. See docs/plugins.md § Loaded plugins.
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
  // rather than depending on its position in the list. Still before the listener binds, and a failure
  // tears down as an init failure does. Iterated over a copy, because containing a failure removes the
  // plugin from `started`.
  for (const plugin of [...started]) {
    if (!plugin.ready) continue
    try {
      await plugin.ready(contexts.get(plugin.name)!)
    } catch (error) {
      if (options.loaded?.has(plugin.name)) {
        await contain(plugin, 'ready', error)
        // Out of both lists: `contain` already disposed it, and leaving it in `started` would dispose it
        // again at shutdown.
        started.splice(started.indexOf(plugin), 1)
        enabled.splice(enabled.indexOf(plugin.name), 1)
        continue
      }
      await disposeStarted(started, closeStorage)
      throw error
    }
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
      return { ok: false, error: `'${name}' is not a plugin this node loaded from disk, so it cannot be reloaded. Built-ins need a restart.` }
    }
    if (disabled.has(name)) return { ok: false, error: `'${name}' is turned off on this node.` }

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

    try {
      // Buffered like everything else: the previous instance's schedules are still on the scheduler
      // under the same keys, and registering now throws on the duplicate.
      registerManifestSchedules(candidateCtx, name, next.binding)
      registerManifestTaskChecks(candidateCtx, name, next.binding)
      registerManifestHooks(candidateCtx, name, next.binding)
      // Not buffered: the registry is keyed by plugin id, so the candidate's declaration overwrites the
      // previous instance's, and a failed reload leaves the fresh manifest's verbs in place, which is
      // what the settings page shows anyway.
      registerEmits(next.plugin, next.binding, (undo) => void candidateUndos.push(undo))
      registerManifestHarnesses(candidateCtx, name, next.binding)
      registerManifestCollections(candidateCtx, next.binding)
      registerManifestNodeActions(candidateCtx, next.binding)
      registerManifestAuditActions(candidateCtx, next.binding)
      await next.plugin.init(candidateCtx)
    } catch (error) {
      // Nothing to roll back. The buffer was never replayed, so the previous instance is still serving,
      // and the candidate's database handle is the only thing it opened.
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

    // ── Commit ─────────────────────────────────────────────────────────────────────────────────────
    // Order matters: stop serving through the previous instance before its dispose runs, close its
    // database only after (agents flushes, workflows aborts and database drains through that handle),
    // and revoke its context last so a leaked reference fails loudly.
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
      // An invalid registration, such as two tools sharing a name, can only surface here, because the
      // registries validate it and the candidate never touched them. The plugin ends up unregistered
      // and marked failed, like a contained boot failure. Candidate-then-commit protects against init
      // throwing, the failure a dev loop produces. Narrowing this window further would mean a
      // validate-only pass in six registries.
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[plugin:${name}] reload could not register the new instance's contributions:`, error)
      clearRegistrations(name)
      for (const undo of candidateUndos.reverse()) undo()
      closeStorage(name)
      try {
        candidate.db?.close()
      } catch {
        // closeStorage already got it, once the candidate's handle had reached the map.
      }
      forget(name)
      markFailed(name, 'init', message)
      return { ok: false, error: message }
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
// Called on two paths. At boot it is idempotency: a second startServiceRuntime in one process must
// replace a plugin's contributions rather than append copies bound to the first boot's closed database.
// On a contained failure it is the rollback.
//
// Exported for tests too: a test that inits a plugin against a real context leaves the same
// registrations in the same process-wide registries, and its cleanup() calls this.
export function clearRegistrations(name: string): void {
  removePluginRoutes(name)
  // The WS hub's two module-singleton slots have no duplicate guard, so a stale handler closed over a
  // disposed engine keeps claiming the prefix silently.
  for (const undo of undoRegistrations.get(name) ?? []) undo()
  undoRegistrations.delete(name)
  removeAgentTools(name)
  // A collection read is a pointer at a route this call just removed, so it goes with it. A survivor
  // leaves the sampler dispatching at a namespace nothing serves.
  clearCollectionReads(name)
  clearNodeActions(name)
  // A run source is a pointer at a route this call just removed, same as a collection read.
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
