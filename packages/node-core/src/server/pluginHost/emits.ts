// Which verbs each plugin has declared other plugins may hear (docs/plugins.md § Hearing another plugin
// § The cross-plugin grant). Filled by the host from a manifest's `emits` or a built-in's
// `NodePlugin.emits`, emptied on unload, and read at subscribe time by `ctx.events.on`.
//
// The contract it enforces has two halves. A producer that is here and did not declare the verb has
// said no, and the subscription throws so the author debugs the right side. A producer that is not here
// at all delivers nothing and errors nothing: it may be uninstalled, disabled, failed, or simply not
// initialised yet, since init order is not a dependency contract, and payloads carry state, so a
// consumer that starts hearing later ends up correct.
import { parsePluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { PluginEmit } from '@acorn/protocol/plugin/contract.ts'

const producers = new Map<string, readonly PluginEmit[]>()

/** Record what `pluginId` announces. Returns the undo, so the host can hang it on the plugin's
 *  registration undo list. */
export function declareEmits(pluginId: string, emits: readonly PluginEmit[]): () => void {
  producers.set(pluginId, emits)
  return () => void producers.delete(pluginId)
}

/** The declared verbs of a producer, or undefined when no such plugin is running. */
export const declaredEmits = (pluginId: string): readonly PluginEmit[] | undefined => producers.get(pluginId)

/** Throw when `channel` names a running producer that did not declare the verb. Silent for an absent
 *  producer, and for the subscriber's own channel. */
export function assertSubscribableVerb(channel: string, subscriber: string): void {
  const parsed = parsePluginChannel(channel)
  if (!parsed || parsed.pluginId === subscriber) return
  const declared = producers.get(parsed.pluginId)
  if (declared && !declared.some((emit) => emit.verb === parsed.verb)) {
    throw new Error(`plugin '${parsed.pluginId}' does not declare '${parsed.verb}' in its emits, so '${subscriber}' cannot subscribe to it`)
  }
}

// Test seam.
export const _resetEmits = (): void => producers.clear()
