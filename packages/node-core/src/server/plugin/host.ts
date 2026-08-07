// The plugin host: builds each plugin's context and runs its init, in declaration order.
//
// Replaces the hand-ordered sequence of eleven wireX() calls in apps/node/src/service/runtime.ts.
// The ordering there was load-bearing (knowledge.notesStore, runtimeService and managedAgents were
// constructed and threaded as deps between calls); here it must NOT be, because a disabled plugin
// removes a step from the sequence. Cross-plugin needs resolve through the capability registry at
// CALL time instead, which is why capabilities.get() is documented as late-binding.
import type { CoreServices } from '../../main/core'
import { registerAgentTool, removeAgentTools } from '../agentTools/registry'
import { asContextSection, registerContextSection, removeContextSections } from '../agentTools/contextSections'
import { registerRoute, removePluginRoutes } from '../routeRegistry'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { modelProviderRegistry } from '../modelProviders/registry'
import type { CapabilityRegistry } from './capabilities'
import type { NodePlugin, NodePluginContext } from './types'
import { registerWsChannelHandler, setStreamHandlers, wsBroadcast } from '../../main/wsHub'
import { broadcastRepoConfigTrustNotice, broadcastStatus, broadcastWorkflowNotice, broadcastWorkflowStepEvent } from '../../main/notify'

// What each plugin claimed on the WS hub, so a re-init can take it back. The hub's slots are module
// singletons with no duplicate guard, unlike the route and tool registries.
const wsRegistrations = new Map<string, (() => void)[]>()

export type PluginHostOptions = {
  // Owned by the caller, not by this module: see the note in capabilities.ts about why these are not
  // module singletons.
  capabilities: CapabilityRegistry
  core: CoreServices
  // Plugin ids the owner has turned off for this node. `required` plugins ignore it — disabling
  // github, terminal or agents is not a supported configuration, and silently honouring it would
  // produce a node that boots and then fails at the first task.
  disabled?: readonly string[]
}

// One row per plugin the composition root offered, whether or not it ran. Settings → Plugins needs the
// whole list — a plugin the owner has turned off has to still appear, with a checkbox — and `enabled`
// plus `skipped` is not that list: it says nothing about which names are `required` and therefore not
// togglable at all.
export type PluginRosterEntry = { name: string; required: boolean; disabled: boolean }

export type PluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
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
  const started: NodePlugin[] = []
  // Kept so the ready pass below hands each plugin the SAME context its init got.
  const contexts = new Map<string, NodePluginContext>()

  for (const plugin of plugins) {
    // Clearing happens BEFORE the disabled check, not after. These registries are module singletons, so
    // a plugin DISABLED on the second boot of one process would otherwise keep the first boot's routes,
    // tools and providers — served through a database handle its dispose already closed. That is the
    // trap the disable flag exists to avoid, so the flag has to be honoured on the clear path too.
    //
    // Idempotent per boot: clear anything this plugin contributed to the module-singleton
    // registries on a previous boot, so a second startServiceRuntime in one process REPLACES its
    // contributions rather than appending copies bound to the first boot's (now closed) database. For
    // routes that silently served every request from a closed handle; for tools it would throw on the
    // duplicate name and fail the whole boot.
    removePluginRoutes(plugin.name)
    // Same reason, for the WS hub's two module-singleton slots: a second boot in one process would
    // otherwise leave the first boot's handler — closed over its now-disposed engine — still claiming
    // the prefix, and registerWsChannelHandler has no duplicate guard to make that loud.
    for (const undo of wsRegistrations.get(plugin.name) ?? []) undo()
    wsRegistrations.delete(plugin.name)
    removeAgentTools(plugin.name)
    removeContextSections(plugin.name)
    // The provider registries are the same class of module singleton, and now written from init too. A
    // second boot would otherwise hit their duplicate-id guards and fail the whole boot rather than
    // silently serving stale contributions. Model adapters first: an adapter is validated against a
    // registered connection provider, so removing the provider first would strand it.
    modelProviderRegistry.removeForPlugin(plugin.name)
    integrationProviderRegistry.removeForPlugin(plugin.name)
    connectionProviderRegistry.removeForPlugin(plugin.name)
    if (disabled.has(plugin.name) && !plugin.required) {
      skipped.push(plugin.name)
      continue
    }
    const ctx: NodePluginContext = {
      name: plugin.name,
      routes: {
        register: (router, opts) =>
          registerRoute({ plugin: plugin.name, prefix: opts?.prefix ?? '', router, note: opts?.note }),
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
      capabilities: options.capabilities,
      core: options.core,
      // The broadcast surface, projected rather than re-implemented: these are main/notify.ts and
      // main/wsHub.ts, reached through the context so a plugin does not deep-import them. `channel` and
      // `streams` return disposers, which the host records like any other contribution.
      events: {
        send: wsBroadcast,
        status: broadcastStatus,
        notice: broadcastWorkflowNotice,
        repoConfigTrustNotice: broadcastRepoConfigTrustNotice,
        stepEvent: broadcastWorkflowStepEvent,
        channel: (prefix, handler) => {
          registerWsChannelHandler(prefix, handler)
          wsRegistrations.set(plugin.name, [...(wsRegistrations.get(plugin.name) ?? []), () => registerWsChannelHandler(prefix, null)])
        },
        streams: (handlers) => {
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
    try {
      await plugin.init(ctx)
    } catch (error) {
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
  for (const plugin of started) {
    if (!plugin.ready) continue
    try {
      await plugin.ready(contexts.get(plugin.name)!)
    } catch (error) {
      await disposeStarted(started)
      throw error
    }
  }

  // Built from the offered list, in declaration order, so a plugin that was skipped still has a row.
  // `disabled` reports what the OWNER asked for, not what the host did — a required plugin named in the
  // list reads `{ required: true, disabled: false }`, because it is running and the UI must not offer to
  // turn it off.
  const roster = plugins.map((plugin) => ({
    name: plugin.name,
    required: plugin.required === true,
    disabled: disabled.has(plugin.name) && plugin.required !== true,
  }))

  return { enabled, skipped, roster, dispose: () => disposeStarted(started) }
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
