// The plugin host: builds each plugin's context and runs its init, in declaration order.
//
// Replaces the hand-ordered sequence of eleven wireX() calls in apps/node/src/service/runtime.ts.
// The ordering there was load-bearing (knowledge.notesStore, runtimeService and managedAgents were
// constructed and threaded as deps between calls); here it must NOT be, because a disabled plugin
// removes a step from the sequence. Cross-plugin needs resolve through the capability registry at
// CALL time instead, which is why capabilities.get() is documented as late-binding.
import type { CoreServices } from '../../main/core'
import type { NodePermissions } from '../../main/pluginManifest'
import { scopeCapabilities, scopeCore } from '../../main/pluginPermissions'
import { registerAgentTool, removeAgentTools } from '../agentTools/registry'
import { asContextSection, registerContextSection, removeContextSections } from '../agentTools/contextSections'
import { registerRoute, removePluginRoutes } from '../routeRegistry'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import type { CapabilityRegistry } from './capabilities'
import type { NodePlugin, NodePluginContext, PluginStorage } from './types'
import { registerWsChannelHandler, setStreamHandlers, wsBroadcast } from '../../main/wsHub'
import { broadcastRepoConfigTrustNotice, broadcastStatus, broadcastWorkflowNotice, broadcastWorkflowStepEvent } from '../../main/notify'

// What each plugin claimed on the WS hub, so a re-init can take it back. The hub's slots are module
// singletons with no duplicate guard, unlike the route and tool registries.
const wsRegistrations = new Map<string, (() => void)[]>()

export type LoadedPluginBinding = {
  permissions: NodePermissions
  storage: PluginStorage
}

export type PluginHostOptions = {
  // Owned by the caller, not by this module: see the note in capabilities.ts about why these are not
  // module singletons.
  capabilities: CapabilityRegistry
  core: CoreServices
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
}

export type PluginFailure = { name: string; error: string; at: number }

export type PluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
  // Loaded plugins whose init or ready threw. Their registrations were rolled back and boot
  // continued; built-ins are never in here, because a built-in throwing still fails the boot.
  failed: readonly PluginFailure[]
  roster: readonly PluginRosterEntry[]
  // Release every initialized plugin, newest first, before the data root lock is dropped. Never
  // rejects: one plugin failing to close must not stop the rest, and teardown is already best-effort.
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
    failed.push({ name: plugin.name, error: error instanceof Error ? error.message : String(error), at: Date.now() })
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
    // disk. Everything below that differs between the two tiers keys off this one value.
    const loaded = options.loaded?.get(plugin.name)
    const permissions = loaded?.permissions
    const ctx: NodePluginContext = {
      name: plugin.name,
      routes: {
        // Absent for a loaded plugin: handing the host a live Hono instance from another realm is
        // exactly what cannot survive the process boundary rung 2 puts there
        // (docs/third-party/node-security.md § Design rules). `undefined as never` rather than a
        // throwing stub, so the failure is the immediate "not a function" an author can act on.
        register: permissions
          ? (undefined as never)
          : (router, opts) => registerRoute({ plugin: plugin.name, prefix: opts?.prefix ?? '', router, note: opts?.note }),
        fetch: (handler, opts) =>
          registerRoute({ plugin: plugin.name, prefix: opts?.prefix ?? '', fetch: handler, note: opts?.note }),
      },
      // The owner is bound here, not passed by the plugin: a plugin cannot contribute a tool under
      // another plugin's name, and cannot remove another plugin's tools.
      tools: { register: (tool) => registerAgentTool(plugin.name, tool) },
      // asContextSection is where core's database handle is DROPPED rather than merely left unused: core's
      // own `issues` section keeps it, a plugin-registered one can never see it, and neither side has to be
      // trusted to remember.
      contextSections: { register: (section) => registerContextSection(plugin.name, asContextSection(section)) },
      // Owner-bound like routes and tools: a plugin cannot contribute a provider under another plugin's
      // name, and so cannot have its contributions cleared by another plugin's re-init.
      providers: {
        integration: (provider, route) => {
          connectionProviderRegistry.register(provider, plugin.name)
          integrationProviderRegistry.register(provider, plugin.name)
          if (route) integrationProviderRegistry.registerRoute({ providerId: provider.id, prefix: '', router: route })
        },
        connection: (provider) => connectionProviderRegistry.register(provider, plugin.name),
        model: (adapter) => modelProviderRegistry.register(adapter, plugin.name),
      },
      // Rung 1 of the containment ladder for a loaded plugin: only the capability ids and CoreServices
      // facets its manifest declared. main/pluginPermissions.ts explains what that does and does not
      // buy — it is least privilege for cooperative code, not a security boundary.
      capabilities: permissions ? scopeCapabilities(options.capabilities, permissions.capabilities) : options.capabilities,
      storage: loaded ? loaded.storage : (undefined as never),
      core: permissions ? scopeCore(options.core, permissions, plugin.name) : options.core,
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
            wsRegistrations.set(plugin.name, [...(wsRegistrations.get(plugin.name) ?? []), () => registerWsChannelHandler(prefix, null)])
          },
        streams: permissions
          ? (undefined as never)
          : (handlers) => {
            setStreamHandlers(handlers)
            wsRegistrations.set(plugin.name, [...(wsRegistrations.get(plugin.name) ?? []), () => setStreamHandlers(null)])
          },
      },
      log: {
        log: (...args: unknown[]) => console.log(`[plugin:${plugin.name}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[plugin:${plugin.name}]`, ...args),
        error: (...args: unknown[]) => console.error(`[plugin:${plugin.name}]`, ...args),
      },
    }
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
      await disposeStarted(started)
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
      await disposeStarted(started)
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
      ...(failure ? { failedAt: failure.at } : {}),
    }
  })

  return { enabled, skipped, failed, roster, dispose: () => disposeStarted(started) }
}

// Everything one plugin contributed to the module-singleton registries, undone.
//
// Called on two paths. At boot it is idempotency: a second startServiceRuntime in one process must
// REPLACE a plugin's contributions rather than append copies bound to the first boot's (now closed)
// database — for routes that silently served every request from a closed handle; for tools it threw
// on the duplicate name and failed the whole boot. On a contained failure it is the rollback: a
// plugin that registered three routes and then threw must not leave those three routes serving.
function clearRegistrations(name: string): void {
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
async function disposeStarted(started: readonly NodePlugin[]): Promise<void> {
  for (const plugin of [...started].reverse()) {
    try {
      await plugin.dispose?.()
    } catch (error) {
      console.warn(`[plugin:${plugin.name}] dispose failed:`, error)
    }
  }
}
