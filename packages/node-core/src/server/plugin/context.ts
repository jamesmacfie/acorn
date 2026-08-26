// The context a plugin's init() receives, assembled in exactly one place. testkit/pluginContext.ts
// calls this function, so a test context cannot drift from the boot context: it is the same object,
// over a temp data root.
//
// This function knows nothing about lifecycle. Ordering, containment, the ready pass, the roster and
// the rollback of everything registered here all stay in host.ts, because they are decisions about a
// set of plugins and this is one plugin's surface.
import type { CoreServices } from '../../main/core'
import type { Env } from '../../main/bindings'
import type { NodePermissions, PluginCollectionDescriptor, PluginCommandDescriptor, PluginHarnessDescriptor, PluginScheduleDescriptor, PluginTaskCheckDescriptor } from '../../main/pluginManifest'
import { scopeCapabilities, scopeCore } from '../../main/pluginPermissions'
import { registerAgentTool } from '../agentTools/registry'
import { registerCollectionRead } from '../collections/registry'
import { registerNodeAction } from '../nodeActions/registry'
import { AGENTS_HARNESS_REGISTRY, qualifiedHarnessId } from './harnesses'
import { registerTaskCheck } from './taskChecks'
import { asContextSection, registerContextSection } from '../agentTools/contextSections'
import { registerRoute } from '../routeRegistry'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import { SCHEDULER } from '../schedules'
import type { CapabilityRegistry, Disposable } from './capabilities'
import type { NodePluginContext, PluginFetchHandler, PluginStorage } from './types'
import { parsePluginChannel, pluginChannel } from '@acorn/protocol/pluginState.ts'
import { registerWsChannelHandler, setStreamHandlers, wsBroadcast } from '../../main/wsHub'
import { broadcastRepoConfigTrustNotice, broadcastStatus, broadcastWorkflowNotice, broadcastWorkflowStepEvent } from '../../main/notify'
import { buildPluginRequestContext } from './requestContext'

// What the loader learned about a plugin it took off disk, and the one flag that separates a loaded
// plugin from a built-in: its presence means "contain its failures" and "shape its context from the
// manifest". Absent for a built-in.
//
// `storage` here is the loader's raw handle, resolved from the manifest-confined chain. This file does
// not read it. See the `storage` option below.
export type LoadedPluginBinding = {
  permissions: NodePermissions
  storage: PluginStorage
  // What the manifest declared as periodic work. Carried on the binding rather than read back off disk,
  // for the same reason `permissions` is: the host binds a manifest's claims to a plugin id, and the
  // loader is the one place that reads the file.
  schedules?: readonly PluginScheduleDescriptor[]
  // And its collections, by the same route: the node-side read registry is synthesised from these
  // `items` paths (../collections/registry.ts), so a loaded plugin's panels can be sampled without a
  // client and without the plugin shipping node code.
  collections?: readonly PluginCollectionDescriptor[]
  // And its commands, of which the host reads one thing: which are `runNodeAction`, so a person can put
  // one on a schedule (../nodeActions/registry.ts). A command's palette entry, keybinding and category
  // are the client's business and never reach here.
  commands?: readonly PluginCommandDescriptor[]
  // And what it declared as archive checks, by the same route as schedules: the registration is
  // synthesised from these two paths so both feeders land through `ctx.taskChecks` (./taskChecks.ts).
  taskChecks?: readonly PluginTaskCheckDescriptor[]
  // And its managed agent harnesses, by the same route. The delivery seam also needs `dir` below, since
  // an adapter entry is a path inside the installed package.
  harnesses?: readonly PluginHarnessDescriptor[]
  // The plugin's installed package directory, for resolving a manifest path the host hands on as an
  // absolute one. Host-side only: this is a path on the node's filesystem and must never reach a route
  // (main/pluginLoader.ts § InstalledPluginInfo).
  dir?: string
}

export type PluginContextOptions = {
  // The plugin id. Every owner-bound registration below is bound from this, not from anything the plugin
  // passes, so a plugin cannot contribute under another plugin's name.
  plugin: string
  capabilities: CapabilityRegistry
  core: CoreServices
  // Host bindings let non-route contributions use the same provider runtime as an authenticated
  // request. Optional for context-shape unit tests that never exercise credential access.
  env?: Env
  loaded?: LoadedPluginBinding
  // Both tiers' storage, and the only place this file looks for it. The caller derives it, from
  // `loaded.storage` for a plugin off disk and from the plugin's own `migrationsModule` for a built-in,
  // then wraps it in whatever lifecycle it owns. host.ts memoizes, so it can close what it handed out.
  //
  // Do not branch on `options.loaded` here. Reading `loaded.storage` directly throws away the host's
  // wrapper, so no loaded handle reaches the host's `opened` map, closing becomes a no-op, and a WAL
  // handle outlives the data-root lock release. The caller already keeps a loaded plugin away from its
  // own `migrationsModule`, so one source of truth is enough.
  storage?: PluginStorage
  // Where an undo goes for a registration `clearRegistrations` cannot reach on its own. The WS hub's two
  // slots are module singletons with no duplicate guard, and a schedule lives in the composition root's
  // scheduler rather than in a module registry. For both, the host records the undo per plugin and takes
  // it back on re-init or on a contained failure. A caller that passes nothing keeps no undo record.
  onUndo?: (undo: () => void) => void
  // The candidate registration set (server/plugin/host.ts § reload). When present, every registration
  // this context hands the plugin is buffered here as a thunk instead of reaching the module-singleton
  // registries, and the host replays it once it decides to commit.
  //
  // All six registries reject duplicate tool names, provider ids and capability ids, and on a reload the
  // previous instance's registrations are still in them. Running the candidate's init straight at the
  // live registries throws on the plugin's own name.
  pending?: (() => void)[]
}

// How a revoked context announces itself. A leaked handle has to fail loudly, or a previous instance
// quietly registers routes nothing serves and writes through a database handle the host has closed.
const revokers = new WeakMap<NodePluginContext, () => void>()

/** Invalidate a context the host has replaced. Called on the previous instance's context after a reload
 * commits (server/plugin/host.ts). Every registration, broadcast and `storage.open()` reached through
 * it throws from then on. `core` and `capabilities.get` stay live: they are host services that did not
 * go anywhere, and wrapping them would mean proxying two large surfaces to catch nothing. */
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
      // Absent for a loaded plugin: a live Hono instance from another realm cannot survive the process
      // boundary rung 2 puts there (docs/security.md § Design rules). `undefined as never` rather than a
      // throwing stub, so the failure is the immediate "not a function" an author can act on.
      register: permissions
        ? (undefined as never)
        : (router, opts) => registerRoute({ plugin, prefix: opts?.prefix ?? '', router, note: opts?.note }),
      fetch: (handler, opts) => registerRoute({ plugin, prefix: opts?.prefix ?? '', fetch: handler, note: opts?.note }),
    },
    // The owner is bound here, not passed by the plugin: a plugin cannot contribute a tool under another
    // plugin's name, and cannot remove another plugin's tools.
    tools: { register: (tool) => registerAgentTool(plugin, tool) },
    // The scheduler resolves through the capability registry at call time rather than being threaded in:
    // the composition root builds it and owns its start and stop, and a context built before it exists
    // must still work.
    //
    // The key is minted from `plugin`, like every other owner-bound registration, which also opts the
    // schedule into the plugin cadence floor, because the engine reads the floor off the key prefix.
    // `timeout` is seconds here and milliseconds there, and this is the one place that converts.
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
        // Dispose removes the definition and keeps the state row, so a plugin's pause and its history are
        // waiting when it comes back.
        recordUndo(() => handle.dispose())
      },
    },
    // Owner-bound like routes and tools. The measure sampler dispatches through this pointer, so a
    // collection filed under a stranger's name has the node reading one plugin's route under another's
    // badge. The route itself is re-confined on every call (../collections/registry.ts).
    collections: {
      register: (collection) => registerCollectionRead({ ...collection, pluginId: plugin }),
    },
    // Owner-bound. This is the list a person picks a scheduled action from, and the tier beside each
    // entry drives the confirmation they accept. Filing one under a stranger's name borrows that
    // plugin's reputation for your own route.
    nodeActions: {
      register: (action) => registerNodeAction({ ...action, pluginId: plugin }),
    },
    // Owner-bound like the three above, and the provenance the dialog draws: every concern this check
    // answers with renders beside the plugin's name.
    taskChecks: {
      register: (check) => registerTaskCheck({ ...check, pluginId: plugin }),
    },
    // Owner-bound like the four above, and here the binding is the id itself: a harness id is persisted
    // into session rows and workflow steps, so minting it from `plugin` keeps one package's sessions out
    // of another package's namespace.
    //
    // The consumer resolves at registration rather than being held, so agents absent means the harness
    // quietly does not exist and re-enabling redelivers.
    harnesses: {
      register: (harness) => {
        const registry = options.capabilities.get(AGENTS_HARNESS_REGISTRY)
        if (!registry) return
        const handle = registry.register({
          ...harness,
          id: qualifiedHarnessId(plugin, harness.id),
          pluginId: plugin,
        })
        recordUndo(() => handle.dispose())
      },
    },
    // asContextSection drops core's database handle rather than leaving it unused: core's own `issues`
    // section keeps it, a plugin-registered one can never see it, and neither side has to remember.
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
      withConnection: async (userId, providerId, visit) => {
        if (!options.env) throw new Error(`Plugin '${plugin}' requested a provider credential without host bindings.`)
        let visited = false
        const values = await buildPluginRequestContext(
          options.env,
          { kind: 'internal', scope: 'service', userId },
          plugin,
        ).providers.withConnections(providerId, async (connection, secret) => {
          // `withConnections` intentionally walks every connection for provider-resource fan-out.
          // A write must choose one or it could perform the action twice, so take the first usable row
          // in the host's stable connection order.
          if (visited) return undefined
          visited = true
          return visit(connection, secret)
        })
        return values[0]
      },
    },
    // Rung 1 of the containment ladder for a loaded plugin: only the capability ids and CoreServices
    // facets its manifest declared. See main/pluginPermissions.ts. This is least privilege for
    // cooperative code, not a security boundary.
    capabilities: permissions ? scopeCapabilities(options.capabilities, permissions.capabilities) : options.capabilities,
    // Both tiers, from the one option the caller derived. `undefined as never` for a plugin that owns no
    // tables, matching routes.register above.
    storage: options.storage ?? (undefined as never),
    core: permissions ? scopeCore(options.core, permissions, plugin) : options.core,
    // The broadcast surface, projected rather than re-implemented: these are main/notify.ts and
    // main/wsHub.ts, reached through the context so a plugin does not deep-import them. `channel` and
    // `streams` return disposers, which the host records like any other contribution.
    events: {
      // Confined to the plugin's own channel namespace for a loaded plugin, unrestricted for a
      // built-in. A built-in owns real prefixes through `channel` below and is compiled into this
      // binary. An unconfined `send` lets a loaded package post frames on `term:` or `workflow:` and
      // impersonate core's own streams. `plugin:<id>:*` is also the namespace its frames may subscribe
      // to and the one a push invalidates its chrome from (client-core/plugins/pluginChannel.ts).
      //
      // A throw rather than a silent drop, because a broadcast that goes nowhere is invisible and leaves
      // the author debugging the renderer.
      send: permissions
        ? (frame) => {
          if (parsePluginChannel(frame.channel)?.pluginId !== plugin) {
            throw new Error(`plugin '${plugin}' may only broadcast on ${pluginChannel(plugin, '<verb>')}, not '${frame.channel}'`)
          }
          wsBroadcast(frame)
        }
        : wsBroadcast,
      status: broadcastStatus,
      notice: broadcastWorkflowNotice,
      repoConfigTrustNotice: broadcastRepoConfigTrustNotice,
      stepEvent: broadcastWorkflowStepEvent,
      // Never present for a loaded plugin, whatever its manifest says. PTY stream ownership and WS
      // channel prefixes are infrastructure exactly one plugin may own, and neither survives a
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
  // One post-pass rather than a wrapper at each of the ten registration sites. Every site above is
  // contextually typed by NodePluginContext, so wrapping inline would cost every parameter an explicit
  // annotation and buy nothing.
  //
  // `routes`, `tools`, `contextSections` and `providers` are pure registrations, so they buffer into the
  // candidate set when there is one. `events` and `storage` are not: a broadcast has to go out when it
  // is sent and `storage.open()` has to return a handle, so those are only revoked. For the tier reload
  // touches that is exact, because `events.channel` and `streams` are the only registrations on `events`
  // and both are absent for a loaded plugin.
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

  for (const group of ['routes', 'tools', 'schedules', 'collections', 'nodeActions', 'taskChecks', 'harnesses', 'contextSections', 'providers', 'events', 'storage'] as const) {
    // Absent for the members a tier does not get (`undefined as never`), which is why this is a typeof
    // check per member rather than a list of names.
    const members = ctx[group] as Record<string, unknown> | undefined
    if (!members) continue
    const buffer = group !== 'events' && group !== 'storage'
    for (const [key, value] of Object.entries(members)) {
      if (typeof value === 'function') members[key] = guard(value as (...args: unknown[]) => unknown, buffer)
    }
  }

  // `capabilities` is the one registration that hands the plugin something back, so it cannot go through
  // the loop above: the Disposable has to work before the replay, cancelling the pending registration,
  // and after it, disposing the real one. `get`, `require` and `ids` are reads and stay as they are.
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
