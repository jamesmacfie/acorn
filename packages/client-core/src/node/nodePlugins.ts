import { createSignal } from 'solid-js'
import { corePluginsRoute, type NodePluginState } from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'
import { activeNodeId } from './activeNode'

// Which plugins the ACTIVE node is running, and therefore which client contributions should exist
// (docs/vNext/ui.md § New surfaces, "Settings → Plugins").
//
// ## Why the client re-runs its plugin host instead of filtering registries
//
// The obvious reading of "enable/disable per node" is a predicate threaded through every registry
// accessor: `panes()` hides a disabled plugin's pane, `availableSources` hides its source, and so on for
// nine registries. That is six or seven filter sites to add and to keep in step, and each one is a place
// a future registry forgets the rule.
//
// `initClientPlugins` already disposes a plugin's previous contributions before re-registering — Phase 3
// built that so a second activation would not hit the registries' duplicate-id guard — so re-running the
// host with a new `disabled` list IS the filter, applied once, in the one place that knows every
// contribution point. The shell is already remounted wholesale on a node switch (the QueryClient
// provider is keyed on the active node), so there is no partial-update problem to solve either.
//
// The list is the NODE's, deliberately. A client-only plugin (changes, context, editor, onboarding has no
// node half) is never in it and so is never disabled: it contributes presentation over core's data, and
// there is nothing on a node to turn off.
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
    // Publish ONLY when this is the active node's list. The signal is the input to the client plugin host,
    // and Settings → Plugins can read any paired node — so a peek at node B while node A is active used to
    // leave the signal describing B, which the next `applyNodePlugins` would have applied to A's shell.
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
