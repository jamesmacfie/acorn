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

/** The engine the composer uses: the first one the only engine plugin declares. Two plugins with
 *  engines is a clash, and neither gets audio, so a newly installed plugin can't take dictation
 *  from the one the person set up.
 *  shortcut: no picker; add one to agent settings if two engines ever need to coexist. */
export function activeSpeechEngine():
  | { kind: 'none' }
  | { kind: 'one'; engine: SpeechEngine }
  | { kind: 'clash'; first: SpeechEngine; pluginIds: string[] } {
  const pluginIds = [...declared.keys()].sort()
  if (!pluginIds.length) return { kind: 'none' }
  const first = { ...declared.get(pluginIds[0]!)![0]!, pluginId: pluginIds[0]! }
  return pluginIds.length === 1 ? { kind: 'one', engine: first } : { kind: 'clash', first, pluginIds }
}

export const speechEngineClash = (pluginIds: readonly string[]) =>
  `More than one plugin offers a speech engine (${pluginIds.join(', ')}), so dictation is off. Turn all but one off in Settings, under Plugins.`
