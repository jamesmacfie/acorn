// The context a plugin's init() receives, assembled in exactly one place. testkit/pluginContext.ts
// calls this function, so a test context cannot drift from the boot context: it is the same object,
// over a temp data root.
//
// This function knows nothing about lifecycle. Ordering, containment, the ready pass, the roster and
// the rollback of everything registered here all stay in host.ts, because they are decisions about a
// set of plugins and this is one plugin's surface.
import type { CoreServices } from '../core'
import type { Env } from '../bindings'
import type { NodePermissions, PluginAuditActionDescriptor, PluginCollectionDescriptor, PluginCommandDescriptor, PluginExtensionDescriptor, PluginExtensionPointDescriptor, PluginHarnessDescriptor, PluginScheduleDescriptor, PluginTaskCheckDescriptor } from '../plugins/manifest'
import { scopeCapabilities, scopeCore } from '../plugins/permissions'
import { registerAgentTool } from '../agentTools/registry'
import { registerCollectionRead } from '../collections/registry'
import { registerNodeAction } from '../nodeActions'
import { registerNodeProvider } from '../nodeProviders/registry'
import { registerRunSource } from '../runs/registry'
import { AGENTS_HARNESS_REGISTRY, qualifiedHarnessId } from './harnesses'
import { registerTaskCheck } from './taskChecks'
import { declareAuditAction, qualifiedAuditAction, recordAudit } from '../audit'
import { contributeExtension, extensionsFor, openExtensionPoint } from './extensionPoints'
import { registerHookHandler, registerHookPoint, runHook } from './hooks'
import { qualifiedExtensionPointId } from '@acorn/protocol/extensionPoints.ts'
import { asContextSection, registerContextSection } from '../agentTools/contextSections'
import { registerRoute } from '../routeRegistry'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import { SCHEDULER } from '../schedules'
import type { CapabilityRegistry, Disposable } from './capabilities'
import type { ExtensionPointId } from './extensionPoints'
import type { HostPluginContext, NodePluginContext, PluginFetchHandler, PluginStorage } from './types'
import { parsePluginChannel, pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { PluginEmit } from '@acorn/protocol/plugin/contract.ts'
import { onWsBroadcast, registerWsChannelHandler, setStreamHandlers, wsBroadcast } from '../transport/wsHub'
import { isNodeEventChannel } from '@acorn/protocol/nodeEvents.ts'
import { assertSubscribableVerb } from './emits'
import { broadcastRepoConfigTrustNotice, broadcastStatus } from '../notify'
import { buildPluginRequestContext } from './requestContext'

// What the loader learned about a plugin it took off disk, and the one flag that separates a loaded
// plugin from a built-in: its presence means "contain its failures" and "shape its context from the
// manifest". Absent for a built-in.
//
// `storage` here is the loader's raw handle, resolved from the manifest-confined chain. This file does
// not read it. See the `storage` option below.
export type LoadedPluginBinding = {
  permissions: NodePermissions
  // The manifest's `permissions.events`, a sibling of the `node` block above rather than part of it.
  // One grant list covers both sides of the wire: the frames subscribe against it in the client broker,
  // and `ctx.events.on` is scoped by it here.
  events?: readonly string[]
  // The manifest's top-level `emits`: the verbs other plugins may subscribe to (./emits.ts).
  emits?: readonly PluginEmit[]
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
  // And the verbs it may write onto the audit trail, by the same route: the declaration is replayed
  // through `ctx.audit.declare` so both feeders land in one registry (../audit.ts).
  auditActions?: readonly PluginAuditActionDescriptor[]
  // And the points it opens and the contributions it makes, of which the host reads the node-side kind:
  // a `hook` point becomes a chain other packages may join, and an extension naming a `route` becomes a
  // handler on somebody else's (./hooks.ts). Every other kind is drawn by the client and never reaches
  // here. Both feeders land through `ctx.hooks`, the same shape schedules and task checks take.
  extensionPoints?: readonly PluginExtensionPointDescriptor[]
  extensions?: readonly PluginExtensionDescriptor[]
  // And its managed agent harnesses, by the same route. The delivery seam also needs `dir` below, since
  // an adapter entry is a path inside the installed package.
  harnesses?: readonly PluginHarnessDescriptor[]
  // The plugin's installed package directory, for resolving a manifest path the host hands on as an
  // absolute one. Host-side only: this is a path on the node's filesystem and must never reach a route
  // (server/plugins/loader.ts § InstalledPluginInfo).
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
  // The candidate registration set (server/pluginHost/host.ts § reload). When present, every registration
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
 * commits (server/pluginHost/host.ts). Every registration, broadcast and `storage.open()` reached through
 * it throws from then on. `core` and `capabilities.get` stay live: they are host services that did not
 * go anywhere, and wrapping them would mean proxying two large surfaces to catch nothing. */
export function revokePluginContext(ctx: NodePluginContext): void {
  revokers.get(ctx)?.()
}

export function buildPluginContext(options: PluginContextOptions): HostPluginContext {
  const plugin = options.plugin
  // Undefined for a built-in, the manifest's `permissions.node` block for a plugin loaded from disk.
  // Everything below that differs between the two tiers keys off this one value.
  const permissions = options.loaded?.permissions
  const recordUndo = options.onUndo ?? (() => {})
  const pending = options.pending
  const ctx: HostPluginContext = {
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
    // Owner-bound. This is the list anything unattended picks an action from — a person arming a
    // schedule today, and whatever asks next — and the tier beside each entry drives the confirmation
    // accepted at that moment. Filing one under a stranger's name borrows that plugin's reputation for
    // your own route.
    nodeActions: {
      register: (action) => registerNodeAction({ ...action, pluginId: plugin }),
    },
    // Owner-bound like the three above, and the provenance the dialog draws: every concern this check
    // answers with renders beside the plugin's name.
    taskChecks: {
      register: (check) => registerTaskCheck({ ...check, pluginId: plugin }),
    },
    // Owner-bound like the rest: a plugin lists its own runs and cannot register a pointer at someone
    // else's route (../runs/registry.ts). The route is re-confined on every read.
    runs: {
      register: (source) => registerRunSource({ ...source, pluginId: plugin }),
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
    // Owner-bound on both halves: `open` refuses a point outside this plugin's namespace, and a
    // contributed entry's id is minted from the plugin rather than taken from the entry. Both
    // registrations record an undo, because the maps behind them are module singletons and a reload's
    // candidate instance has to be able to take back what it filed.
    extensionPoints: {
      declare: (point, label) => recordUndo(openExtensionPoint(plugin, point as ExtensionPointId<unknown>, label).dispose),
      handle: (point, entry) => recordUndo(contributeExtension(plugin, point, entry).dispose),
      handlers: (point) => extensionsFor(point),
      // The names these three carried until 2026-08-31, kept for one major so a plugin outside this
      // repository moves on its own schedule (docs/plugins.md § The plugin API). Aliases rather than
      // wrappers, so the guard pass below wraps each of the six once and both spellings behave the same.
      open: (point, label) => recordUndo(openExtensionPoint(plugin, point as ExtensionPointId<unknown>, label).dispose),
      contribute: (point, entry) => recordUndo(contributeExtension(plugin, point, entry).dispose),
      entries: (point) => extensionsFor(point),
    },
    // Owner-bound on both halves, like the extension points above. `declare` mints the point id from
    // this plugin, `handle` mints the handler id from it, and `run` takes a bare id and qualifies it, so
    // a plugin can only ever run a chain it declared. Both registrations record an undo, because the
    // maps behind them are module singletons and a reload's candidate instance has to be able to take
    // back what it filed.
    //
    // A handler registered here is a function, not a route: this is the built-in carrier, and the host
    // builds the route-carrying one from a loaded plugin's manifest (./host.ts). Nothing inside the
    // chain runner can tell which it has.
    hooks: {
      declare: (point) => recordUndo(registerHookPoint({
        id: qualifiedExtensionPointId(plugin, point.id),
        ownerId: plugin,
        payload: point.payload,
        allows: point.allows,
        timeoutMs: point.timeoutMs ?? 5_000,
        onTimeout: point.onTimeout ?? 'allow',
        order: point.order ?? 'priority',
        collect: point.collect ?? false,
      }).dispose),
      handle: (point, handler) => recordUndo(registerHookHandler({
        id: `${plugin}:${handler.id}`,
        pluginId: plugin,
        point,
        mode: handler.mode,
        priority: handler.priority ?? 500,
        call: (payload, signal) => handler.run(payload, signal),
      }).dispose),
      run: (id, payload) => runHook(qualifiedExtensionPointId(plugin, id), payload),
    },
    // Owner-bound on both halves, like the extension points below: `declare` qualifies the verb with
    // this plugin's id, and `record` refuses anything outside what this plugin declared. Writing goes
    // straight to core's table because the trail is core's — a plugin owning its own audit rows would
    // be a second trail nobody reviews.
    //
    // The actor is `system`, not `internal`: nothing asked for this over a request. `actorId` carries
    // the plugin id so "which package wrote this" is answerable even though the qualified verb already
    // says so.
    audit: {
      declare: (action) => declareAuditAction(plugin, action),
      record: (action, entry) => {
        if (!options.env) return // no host bindings — a context-shape unit test, with no table to write to
        recordAudit(options.env.DB, {
          actor: 'system',
          actorId: plugin,
          action: qualifiedAuditAction(plugin, action),
          ...(entry ?? {}),
        })
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
      nodes: (provider) => registerNodeProvider(plugin, provider),
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
    // facets its manifest declared. See server/plugins/permissions.ts. This is least privilege for
    // cooperative code, not a security boundary.
    capabilities: permissions ? scopeCapabilities(options.capabilities, permissions.capabilities, plugin) : options.capabilities,
    // Both tiers, from the one option the caller derived. `undefined as never` for a plugin that owns no
    // tables, matching routes.register above.
    storage: options.storage ?? (undefined as never),
    core: permissions ? scopeCore(options.core, permissions, plugin) : options.core,
    // The broadcast surface, projected rather than re-implemented: these are server/notify.ts and
    // server/transport/wsHub.ts, reached through the context so a plugin does not deep-import them. `channel` and
    // `streams` return disposers, which the host records like any other contribution.
    events: {
      // Confined to the plugin's own channel namespace for a loaded plugin, unrestricted for a
      // built-in. A built-in owns real prefixes through `channel` below and is compiled into this
      // binary. An unconfined `send` lets a loaded package post frames on `term:` or `workflow:` and
      // impersonate core's own streams. `plugin:<id>:*` is also the namespace its frames may subscribe
      // to and the one a push invalidates its chrome from (client-core/host/plugins/pluginChannel.ts).
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
      repoConfigTrustNotice: broadcastRepoConfigTrustNotice,
      // The receive side (docs/plugins.md § Hearing another plugin). Scoped by the same
      // `permissions.events` grant the plugin's frames are scoped by, so there is one vocabulary and
      // one prompt sentence per grant rather than two of each. A built-in has no manifest and hears
      // whatever the catalogue names.
      //
      // A throw rather than a silent no-op, for the same reason `send` throws: a subscription that
      // never fires is invisible, and the author debugs the producer.
      on: (event, listener) => {
        // Another plugin's verb, or a core event: same grant list, one prompt sentence each. The
        // producer check is the emits registry's (./emits.ts), and it is silent for a producer that is
        // not running.
        if (parsePluginChannel(event)) assertSubscribableVerb(event, plugin)
        else if (!isNodeEventChannel(event)) throw new Error(`'${event}' is not a core event this node publishes`)
        if (permissions && !(options.loaded?.events ?? []).includes(event)) {
          throw new Error(`plugin '${plugin}' did not declare '${event}' in permissions.events`)
        }
        const off = onWsBroadcast((frame) => {
          if (frame.channel === event) listener(frame)
        })
        recordUndo(off)
        return { dispose: off }
      },
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
  }

  // ── Buffering and revocation, both for reload (server/pluginHost/host.ts) ───────────────────────────
  //
  // One post-pass rather than a wrapper at each of the ten registration sites. Every site above is
  // contextually typed by HostPluginContext, so wrapping inline would cost every parameter an explicit
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

  for (const group of ['routes', 'tools', 'schedules', 'collections', 'nodeActions', 'runs', 'taskChecks', 'harnesses', 'contextSections', 'audit', 'extensionPoints', 'hooks', 'providers', 'events', 'storage'] as const) {
    // Absent for the members a tier does not get (`undefined as never`), which is why this is a typeof
    // check per member rather than a list of names.
    const members = ctx[group] as Record<string, unknown> | undefined
    if (!members) continue
    // `events` and `storage` are not registrations at all; `audit.record` is a write that has to land
    // when it is called, while `audit.declare` beside it is an ordinary registration that buffers.
    const buffer = group !== 'events' && group !== 'storage'
    for (const [key, value] of Object.entries(members)) {
      // `extensionPoints.handlers` reads (under both its spellings), `audit.record` writes, and
      // `hooks.run` awaits a chain and answers the caller: all are guarded against a revoked context like
      // the rest and none is ever deferred, because a buffered call would return undefined to a caller
      // about to act on it.
      const reads = key === 'handlers' || key === 'entries' || key === 'record' || key === 'run'
      if (typeof value === 'function') {
        members[key] = guard(value as (...args: unknown[]) => unknown, buffer && !reads)
      }
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
