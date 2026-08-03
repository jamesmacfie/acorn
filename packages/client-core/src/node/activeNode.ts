import { createSignal } from 'solid-js'

// Which node the renderer's ambient requests go to.
//
// Every `*Route` builder produces a node-relative path with no node in it, and threading a nodeId
// through all 34 query-option factories and 135 route builders would be a large, permanent tax for a
// single-active-node UI. So the active node is ambient, and apiClient reads it.
//
// The invariant that makes ambient safe: only the ACTIVE node's QueryClient provider is mounted, and
// `setActiveNode` runs before the provider swaps. Unmounting a provider cancels its in-flight queries,
// so a request cannot be started under node A and resolved into node B's cache.
//
// Fleet fan-out (Phase 4's aggregated surfaces) does not use this — it passes an explicit nodeId,
// which is also the escape hatch for tests.

const [activeNodeId, setActiveNodeIdSignal] = createSignal<string | null>(null)

export { activeNodeId }

export function setActiveNode(nodeId: string | null): void {
  setActiveNodeIdSignal(nodeId)
}
