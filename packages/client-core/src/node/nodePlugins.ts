import { createSignal } from 'solid-js'
import { corePluginsRoute, type NodePluginState } from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'
import { activeNodeId } from './activeNode'
import { onScopeEvicted } from '../registries/scopeEviction'

const [nodePlugins, setNodePlugins] = createSignal<NodePluginState | null>(null)

export { nodePlugins }

// Empty until the first read resolves, which is the right default: a node that has not answered yet must
// not be assumed to have anything disabled, or the first paint would drop panes and then add them back.
export const disabledNodePlugins = (): readonly string[] =>
  (nodePlugins()?.plugins ?? []).filter((row) => row.disabled).map((row) => row.name)

// A read failure returns null and leaves the SIGNAL untouched. Two consequences, both wanted: the previous
// answer keeps applying (dropping to "nothing disabled" would re-register a plugin the owner turned off,
// which is worse than a stale list), and the caller can tell "the node answered" from "it did not" —
// `applyNodePlugins` uses that to decide whether to remember the node as applied or retry on the next mount.
export async function refreshNodePlugins(nodeId?: string): Promise<NodePluginState | null> {
  try {
    const state = await readJson<NodePluginState>(corePluginsRoute, nodeId ? { nodeId } : {})
    if (!nodeId || nodeId === activeNodeId()) setNodePlugins(state)
    return state
  } catch (error) {
    console.warn('[fleet] could not read the node plugin list:', error)
    return null
  }
}

// The owner's toggle. Errors propagate: this one is a deliberate action with a form behind it, so it must
// report a failure rather than swallow it the way the read does.
export async function saveDisabledNodePlugins(disabled: readonly string[], nodeId?: string): Promise<NodePluginState> {
  const state = await writeJson<NodePluginState>(
    corePluginsRoute,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: [...disabled] }),
      ...(nodeId ? { nodeId } : {}),
    },
    (res) => `plugins ${res.status}`,
  )
  // Same rule as the read: only the active node's list may become the host's input.
  if (!nodeId || nodeId === activeNodeId()) setNodePlugins(state)
  return state
}

// Test seam, and the node-switch reset: a stale list from the previous node must not decide which
// contributions the next node's shell gets.
export function clearNodePlugins(): void {
  setNodePlugins(null)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') clearNodePlugins()
})
