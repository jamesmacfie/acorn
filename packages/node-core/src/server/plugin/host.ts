// The plugin host: builds each plugin's context and runs its init, in declaration order.
//
// Replaces the hand-ordered sequence of eleven wireX() calls in apps/node/src/service/runtime.ts.
// The ordering there was load-bearing (knowledge.notesStore, runtimeService and managedAgents were
// constructed and threaded as deps between calls); here it must NOT be, because a disabled plugin
// removes a step from the sequence. Cross-plugin needs resolve through the capability registry at
// CALL time instead, which is why capabilities.get() is documented as late-binding.
import type { CoreServices } from '../../main/core'
import { registerAgentTool, removeAgentTools } from '../agentTools/registry'
import { registerRoute, removePluginRoutes } from '../routeRegistry'
import type { CapabilityRegistry } from './capabilities'
import type { NodePlugin, NodePluginContext } from './types'

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

export type PluginHostResult = {
  enabled: readonly string[]
  skipped: readonly string[]
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

  for (const plugin of plugins) {
    if (disabled.has(plugin.name) && !plugin.required) {
      skipped.push(plugin.name)
      continue
    }
    // Idempotent per boot: clear anything this plugin contributed to the two module-singleton
    // registries on a previous boot, so a second startServiceRuntime in one process REPLACES its
    // contributions rather than appending copies bound to the first boot's (now closed) database. For
    // routes that silently served every request from a closed handle; for tools it would throw on the
    // duplicate name and fail the whole boot.
    removePluginRoutes(plugin.name)
    removeAgentTools(plugin.name)
    const ctx: NodePluginContext = {
      name: plugin.name,
      routes: {
        register: (router, opts) =>
          registerRoute({ plugin: plugin.name, prefix: opts?.prefix ?? '', router, note: opts?.note }),
      },
      // The owner is bound here, not passed by the plugin: a plugin cannot contribute a tool under
      // another plugin's name, and cannot remove another plugin's tools.
      tools: { register: (tool) => registerAgentTool(plugin.name, tool) },
      capabilities: options.capabilities,
      core: options.core,
      log: {
        log: (...args: unknown[]) => console.log(`[plugin:${plugin.name}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[plugin:${plugin.name}]`, ...args),
        error: (...args: unknown[]) => console.error(`[plugin:${plugin.name}]`, ...args),
      },
    }
    // Not caught: a plugin that cannot initialize leaves the node in an unknown state, and every
    // plugin here is first-party code shipped in the same binary. Failing the boot is the honest
    // outcome — the supervisor surfaces it on the recovery screen.
    await plugin.init(ctx)
    started.push(plugin)
    enabled.push(plugin.name)
  }

  return {
    enabled,
    skipped,
    dispose: async () => {
      for (const plugin of [...started].reverse()) {
        try {
          await plugin.dispose?.()
        } catch (error) {
          console.warn(`[plugin:${plugin.name}] dispose failed:`, error)
        }
      }
    },
  }
}
