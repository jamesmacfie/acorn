import { createSignal } from 'solid-js'
import { acornGlobal } from '../capabilities'

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

// How far the client has got in finding a node to talk to. This is what the shell gates on, in the
// place the GitHub session used to be gated: there is no login any more, so the only question left
// before the app may fetch anything is "which node answers?" (docs/vNext/architecture.md § How the
// client talks to nodes).
export type NodeReadiness =
  | { kind: 'starting' } // asking the broker for the fleet — the bundled local node's whole story
  | { kind: 'ready' } // a node is selected, or the serving origin IS the node (see below)
  | { kind: 'unpaired' } // the broker knows no nodes: nothing to talk to until the owner pairs one
  | { kind: 'failed'; reason: string } // the broker itself could not answer

const [nodeReadiness, setNodeReadiness] = createSignal<NodeReadiness>({ kind: 'starting' })

export { nodeReadiness }

export const nodeReady = (): boolean => nodeReadiness().kind === 'ready'

// Pick the node this window talks to. Called once before the first render, and again by the recovery
// screen's Retry — which is what makes `starting` a state the user can actually observe.
export async function selectActiveNode(): Promise<void> {
  const fleetList = acornGlobal()?.fleetList
  // No broker at all: the renderer is being served by a node directly (`dev:node` in a browser), so
  // the origin already IS the node and apiClient's same-origin fallback covers it. Nothing to select,
  // and gating the shell on a selection would leave that mode staring at the recovery screen forever.
  if (!fleetList) {
    setNodeReadiness({ kind: 'ready' })
    return
  }

  setNodeReadiness({ kind: 'starting' })
  try {
    const fleet = await fleetList()
    // Prefer the bundled local node; choosing among several arrives with Settings → Nodes.
    const node = fleet.nodes.find((n) => n.local) ?? fleet.nodes[0]
    if (!node) {
      setNodeReadiness({ kind: 'unpaired' })
      return
    }
    setActiveNode(node.nodeId)
    setNodeReadiness({ kind: 'ready' })
  } catch (error) {
    setNodeReadiness({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) })
  }
}
