import { createSignal } from 'solid-js'
import { corePluginsRoute, type NodePluginState } from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'

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

// A read failure leaves the previous answer in place rather than clearing it. The route is device-only and
// bridge-backed, so the two realistic failures are "this node is offline" and "an older node has no such
// route" — and in both cases dropping to "nothing disabled" would re-register a plugin the owner turned
// off, which is worse than a stale list.
export async function refreshNodePlugins(nodeId?: string): Promise<NodePluginState | null> {
  try {
    const state = await readJson<NodePluginState>(corePluginsRoute, nodeId ? { nodeId } : {})
    setNodePlugins(state)
    return state
  } catch (error) {
    console.warn('[fleet] could not read the node plugin list:', error)
    return nodePlugins()
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
  setNodePlugins(state)
  return state
}

// Test seam, and the node-switch reset: a stale list from the previous node must not decide which
// contributions the next node's shell gets.
export function clearNodePlugins(): void {
  setNodePlugins(null)
}
