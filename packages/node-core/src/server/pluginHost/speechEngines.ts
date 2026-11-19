// The speech engines each running loaded plugin declares in `contributions.speechEngines`, for the core
// speech routes (docs/agent-tools/speech-engines.md). Filled by the host from the binding and emptied
// with the plugin's other registrations, so a disabled plugin's engine is gone at the next read.
import type { PluginSpeechEngineDescriptor } from '@acorn/protocol/plugin/runtimeContributions.ts'

export type SpeechEngine = PluginSpeechEngineDescriptor & { pluginId: string }

const declared = new Map<string, readonly PluginSpeechEngineDescriptor[]>()

/** Record what `pluginId` declares. The manifest parse already confined each route to the plugin.
 *  Returns the undo for the plugin's registration list. */
export function declareSpeechEngines(pluginId: string, engines: readonly PluginSpeechEngineDescriptor[]): () => void {
  if (!engines.length) return () => {}
  declared.set(pluginId, engines)
  return () => {
    if (declared.get(pluginId) === engines) declared.delete(pluginId)
  }
}

/** The engine the composer uses: the first one by plugin ID, then by declaration order.
 *  shortcut: no picker yet, so a second engine plugin is never used; add one to agent settings if
 *  anyone installs two. */
export function activeSpeechEngine(): SpeechEngine | undefined {
  const pluginId = [...declared.keys()].sort()[0]
  const engine = pluginId === undefined ? undefined : declared.get(pluginId)![0]
  return engine && { ...engine, pluginId: pluginId! }
}
