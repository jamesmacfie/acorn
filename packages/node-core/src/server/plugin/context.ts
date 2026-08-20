// The context a plugin's init() receives, assembled in exactly one place.
//
// It used to be a literal inside the loop in host.ts, which is the only place that needed it at boot —
// but a plugin's TEST had no way to get one, so thirteen plugins hand-forged
// `{ … } as unknown as NodePluginContext` and the forgeries drifted from this shape in silence.
// testkit/pluginContext.ts calls THIS function, so a test context cannot drift from the boot context:
// it is the same object, over a temp data root.
//
// The function is deliberately dumb about lifecycle. Ordering, containment, the ready pass, the roster
// and the rollback of everything registered here all stay in host.ts, because they are decisions about
// a SET of plugins and this is one plugin's surface.
import type { CoreServices } from '../../main/core'
import type { NodePermissions, PluginCollectionDescriptor, PluginCommandDescriptor, PluginScheduleDescriptor, PluginTaskCheckDescriptor } from '../../main/pluginManifest'
import { scopeCapabilities, scopeCore } from '../../main/pluginPermissions'
import { registerAgentTool } from '../agentTools/registry'
import { registerCollectionRead } from '../collections/registry'
import { registerNodeAction } from '../nodeActions/registry'
import { registerTaskCheck } from './taskChecks'
import { asContextSection, registerContextSection } from '../agentTools/contextSections'
import { registerRoute } from '../routeRegistry'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import { SCHEDULER } from '../schedules'
import type { CapabilityRegistry, Disposable } from './capabilities'
import type { NodePluginContext, PluginFetchHandler, PluginStorage } from './types'
import { registerWsChannelHandler, setStreamHandlers, wsBroadcast } from '../../main/wsHub'
import { broadcastRepoConfigTrustNotice, broadcastStatus, broadcastWorkflowNotice, broadcastWorkflowStepEvent } from '../../main/notify'

// What the loader learned about a plugin it took off disk, and the ONE flag that separates a loaded
// plugin from a built-in: its presence means "contain its failures" and "shape its context from the
// manifest". Absent for a built-in.
//
// `storage` here is the loader's RAW handle, resolved from the manifest-confined chain. It is
// deliberately not read by this file — see the `storage` option below.
export type LoadedPluginBinding = {
  permissions: NodePermissions
  storage: PluginStorage
  // What the manifest declared as periodic work. Carried on the binding rather than read back off disk,
  // for the same reason `permissions` is: the host is the one that binds a manifest's claims to a plugin
  // id, and the loader is the one place that read the file.
  schedules?: readonly PluginScheduleDescriptor[]
  // And what it declared as collections, for the same reason and by the same route: the node-side
  // read registry is synthesised from these `items` paths (../collections/registry.ts), so a loaded
  // plugin's panels can be sampled without a client and without the plugin shipping node code.
  collections?: readonly PluginCollectionDescriptor[]
  // And its commands, of which the host reads exactly one thing: which are `runNodeAction`, so a
  // person can put one on a schedule (../nodeActions/registry.ts). The rest of a command — its
  // palette entry, its keybinding, its category — is the CLIENT's business and never reaches here.
  commands?: readonly PluginCommandDescriptor[]
  // And what it declared as archive checks, by the same route as schedules: the registration is
  // synthesised from these two paths so both feeders land through `ctx.taskChecks`
  // (./taskChecks.ts).
  taskChecks?: readonly PluginTaskCheckDescriptor[]
}

export type PluginContextOptions = {
  // The plugin id. Every owner-bound registration below is bound from this, not from anything the
  // plugin passes, so a plugin cannot contribute under another plugin's name.
  plugin: string
  capabilities: CapabilityRegistry
  core: CoreServices
  loaded?: LoadedPluginBinding
  // BOTH tiers' storage, and the only place this file will look for it. The caller derives it — from
  // `loaded.storage` for a plugin off disk, from the plugin's own `migrationsModule` declaration for a
  // built-in — and wraps it in whatever lifecycle it owns (host.ts memoizes, so it can close what it
  // handed out).
  //
  // This used to be `options.loaded ? options.loaded.storage : options.storage`, to stop a bundle that
  // sets `migrationsModule` on its exported object from redirecting its own migrator away from the
  // manifest chain. That ternary threw away the host's wrapper for the loaded tier, so no loaded handle
  // ever reached the host's `opened` map and closing it was a permanent no-op: a WAL handle outlived the
  // plugins drain, the sqlite drain and the data-root lock release. The confinement it was protecting
  // does not need it — the caller never reads `migrationsModule` for a loaded plugin (host.ts:112) — so
  // the derivation is the caller's single responsibility and there is one source of truth here.
  storage?: PluginStorage
  // Where an undo goes for a registration `clearRegistrations` cannot reach on its own. The WS hub's two
  // slots are module singletons with no duplicate guard, and a schedule lives in the composition root's
  // scheduler rather than in a module registry — so for both, the host records the undo per plugin and
  // takes it back on re-init or on a contained failure. A caller that passes nothing (a test) simply
  // keeps no undo record.
  onUndo?: (undo: () => void) => void
  // The CANDIDATE registration set (server/plugin/host.ts § reload). When present, every registration
  // this context hands the plugin is buffered here as a thunk instead of reaching the module-singleton
  // registries, and the host replays it only once it has decided to commit.
  //
  // It exists because all six registries reject a duplicate — tool names, provider ids, capability ids —
  // and on a reload the PREVIOUS instance's registrations are still in them. Running the candidate's
  // init straight at the live registries would throw on the plugin's own name, which would make
  // "if init throws, the previous registrations stay fully live" unreachable rather than merely untested.
  pending?: (() => void)[]
}

// How a revoked context announces itself. A leaked handle failing loudly here is the whole point: the
// alternative is a previous instance quietly registering routes nothing serves, or writing through a
// database handle the host has already closed.
const revokers = new WeakMap<NodePluginContext, () => void>()

/** Invalidate a context the host has replaced. Called on the PREVIOUS instance's context after a reload
 * commits (server/plugin/host.ts); every registration, broadcast and `storage.open()` reached through it
 * throws from then on. `core` and `capabilities.get` are deliberately still live — they are host services
 * that did not go anywhere, and wrapping them would mean proxying two large surfaces to catch nothing. */
export function revokePluginContext(ctx: NodePluginContext): void {
  revokers.get(ctx)?.()
}

export function buildPluginContext(options: PluginContextOptions): NodePluginContext {
  const plugin = options.plugin
  // Undefined for a built-in, the manifest's `permissions.node` block for a plugin loaded from disk.
  // Everything below that differs between the two tiers keys off this one value.
  const permissions = options.loaded?.permissions
  const recordUndo = options.onUndo ?? (() => {})
  const pending = options.pending
  const ctx: NodePluginContext = {
    name: plugin,
    routes: {
      // Absent for a loaded plugin: handing the host a live Hono instance from another realm is
      // exactly what cannot survive the process boundary rung 2 puts there
      // (docs/security.md § Design rules). `undefined as never` rather than a
      // throwing stub, so the failure is the immediate "not a function" an author can act on.
      register: permissions
        ? (undefined as never)
        : (router, opts) => registerRoute({ plugin, prefix: opts?.prefix ?? '', router, note: opts?.note }),
      fetch: (handler, opts) => registerRoute({ plugin, prefix: opts?.prefix ?? '', fetch: handler, note: opts?.note }),
    },
    // The owner is bound here, not passed by the plugin: a plugin cannot contribute a tool under
    // another plugin's name, and cannot remove another plugin's tools.
    tools: { register: (tool) => registerAgentTool(plugin, tool) },
    // The scheduler is resolved through the capability registry at CALL time rather than threaded into
    // this function, for the reason host.ts states about cross-plugin needs generally: it is built by the
    // composition root, which owns its start/stop, and a context built before it exists must still work.
    //
    // The key is minted from `plugin`, exactly as every other owner-bound registration is — which is also
    // what opts the schedule into the plugin cadence floor, because the engine reads the floor off the key
    // prefix. `timeout` is seconds here and milliseconds there; this is the one place that converts.
    schedules: {
      register: (schedule) => {
        const scheduler = options.capabilities.get(SCHEDULER)
        if (!scheduler) throw new Error(`Plugin '${plugin}' registered a schedule, but this node has no scheduler.`)
        const handle = scheduler.register({
          key: `${plugin}:${schedule.scheduleId}`,
          name: schedule.name,
          cadence: schedule.cadence,
          ...(schedule.enabled === undefined ? {} : { enabled: schedule.enabled }),
          ...(schedule.timeout === undefined ? {} : { timeoutMs: schedule.timeout * 1000 }),
          run: schedule.run,
        })
        // Dispose removes the DEFINITION and keeps the state row, which is what makes a plugin's
        // lifecycle non-destructive: its pause and its history are waiting when it comes back.
        recordUndo(() => handle.dispose())
      },
    },
    // Owner-bound like routes and tools, and for the sharper version of the same reason: this pointer
    // is what the measure sampler dispatches through, so a collection filed under a stranger's name
    // would have the node reading one plugin's route under another's badge. The route itself is
    // re-confined on every call (../collections/registry.ts), which is the belt to this brace.
    collections: {
      register: (collection) => registerCollectionRead({ ...collection, pluginId: plugin }),
    },
    // Owner-bound for the sharpest version of the reason yet: this is the list a person picks a
    // scheduled action from, and the tier beside each entry is what the confirmation they accept is
    // drawn from. A plugin filing one under a stranger's name would be borrowing that plugin's
    // reputation for its own route.
    nodeActions: {
      register: (action) => registerNodeAction({ ...action, pluginId: plugin }),
    },
    // Owner-bound like the three above, and here it is also the provenance the DIALOG draws: every
    // concern this check answers with is rendered beside the plugin's name, so filing one under a
    // stranger's name would be putting words in that plugin's mouth in front of the owner.
    taskChecks: {
      register: (check) => registerTaskCheck({ ...check, pluginId: plugin }),
    },
    // asContextSection is where core's database handle is DROPPED rather than merely left unused: core's
    // own `issues` section keeps it, a plugin-registered one can never see it, and neither side has to be
    // trusted to remember.
    contextSections: { register: (section) => registerContextSection(plugin, asContextSection(section)) },
    // Owner-bound like routes and tools: a plugin cannot contribute a provider under another plugin's
    // name, and so cannot have its contributions cleared by another plugin's re-init.
    providers: {
      integration: (provider, route) => {
        connectionProviderRegistry.register(provider, plugin)
        integrationProviderRegistry.register(provider, plugin)
        if (!route) return
        if (permissions && typeof route !== 'function') {
          throw new Error(`Plugin '${plugin}' passed a Hono router to providers.integration; loaded plugins must pass a fetch handler.`)
        }
        integrationProviderRegistry.registerRoute({
          providerId: provider.id,
          prefix: '',
          ...(typeof route === 'function'
            ? { fetch: route as PluginFetchHandler }
            : { router: route }),
        })
      },
      connection: (provider) => connectionProviderRegistry.register(provider, plugin),
      model: (adapter) => modelProviderRegistry.register(adapter, plugin),
    },
    // Rung 1 of the containment ladder for a loaded plugin: only the capability ids and CoreServices
    // facets its manifest declared. main/pluginPermissions.ts explains what that does and does not
    // buy — it is least privilege for cooperative code, not a security boundary.
    capabilities: permissions ? scopeCapabilities(options.capabilities, permissions.capabilities) : options.capabilities,
    // Both tiers, from the one option the caller derived. `undefined as never` for a plugin that owns no
    // tables, matching routes.register above.
    storage: options.storage ?? (undefined as never),
    core: permissions ? scopeCore(options.core, permissions, plugin) : options.core,
    // The broadcast surface, projected rather than re-implemented: these are main/notify.ts and
    // main/wsHub.ts, reached through the context so a plugin does not deep-import them. `channel` and
    // `streams` return disposers, which the host records like any other contribution.
    events: {
      send: wsBroadcast,
      status: broadcastStatus,
      notice: broadcastWorkflowNotice,
      repoConfigTrustNotice: broadcastRepoConfigTrustNotice,
      stepEvent: broadcastWorkflowStepEvent,
      // Never present for a loaded plugin, whatever its manifest says. PTY stream ownership and WS
      // channel prefixes are infrastructure that exactly one plugin may own, and neither survives a
      // message-passing boundary (README § Two tiers).
      channel: permissions
        ? (undefined as never)
        : (prefix, handler) => {
          registerWsChannelHandler(prefix, handler)
          recordUndo(() => registerWsChannelHandler(prefix, null))
        },
      streams: permissions
        ? (undefined as never)
        : (handlers) => {
          setStreamHandlers(handlers)
          recordUndo(() => setStreamHandlers(null))
        },
    },
    log: {
      log: (...args: unknown[]) => console.log(`[plugin:${plugin}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[plugin:${plugin}]`, ...args),
      error: (...args: unknown[]) => console.error(`[plugin:${plugin}]`, ...args),
    },
  }

  // ── Buffering and revocation, both for reload (server/plugin/host.ts) ───────────────────────────
  //
  // One post-pass rather than a wrapper at each of the ten registration sites, because every site above
  // is contextually typed by NodePluginContext and wrapping them inline would cost every parameter an
  // explicit annotation to buy nothing.
  //
  // `routes`, `tools`, `contextSections` and `providers` are pure registrations, so they buffer into the
  // candidate set when there is one. `events` and `storage` are not registrations — a broadcast has to go
  // out when it is sent and `storage.open()` has to return a handle — so those are only revoked. That is
  // exact rather than convenient for the tier reload touches: `events.channel`/`streams` are the only
  // registrations on `events` and both are absent for a loaded plugin.
  let revoked = false
  const guard = <A extends unknown[], R>(fn: (...args: A) => R, buffer: boolean): ((...args: A) => R) =>
    (...args: A): R => {
      if (revoked) {
        throw new Error(`Plugin '${plugin}' used a context from a previous load; that instance was replaced by a reload.`)
      }
      if (!buffer || !pending) return fn(...args)
      pending.push(() => void fn(...args))
      return undefined as R
    }

  for (const group of ['routes', 'tools', 'schedules', 'collections', 'nodeActions', 'taskChecks', 'contextSections', 'providers', 'events', 'storage'] as const) {
    // Absent for the members a tier does not get (`undefined as never`), which is why this is a
    // typeof check per member rather than a list of names.
    const members = ctx[group] as Record<string, unknown> | undefined
    if (!members) continue
    const buffer = group !== 'events' && group !== 'storage'
    for (const [key, value] of Object.entries(members)) {
      if (typeof value === 'function') members[key] = guard(value as (...args: unknown[]) => unknown, buffer)
    }
  }

  // `capabilities` is the one registration that hands the plugin something back, so it cannot go through
  // the loop above: the Disposable has to work both before the replay (cancel the pending registration)
  // and after it (dispose the real one). `get`/`require`/`ids` are reads and stay exactly as they are.
  if (pending) {
    const scoped = ctx.capabilities
    ctx.capabilities = {
      get: (id) => scoped.get(id),
      require: (id) => scoped.require(id),
      ids: () => scoped.ids(),
      provide: (id, impl) => {
        let real: Disposable | null = null
        let cancelled = false
        pending.push(() => {
          if (!cancelled) real = scoped.provide(id, impl)
        })
        return {
          dispose: () => {
            cancelled = true
            real?.dispose()
          },
        }
      },
    }
  }

  revokers.set(ctx, () => void (revoked = true))
  return ctx
}
