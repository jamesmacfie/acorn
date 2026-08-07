import { createSignal } from 'solid-js'
import { acornGlobal } from '../capabilities'
import { clientEvents } from '../registries/clientEvents'
import { homeNode, nodes, ORIGIN_NODE_ID, refreshFleet } from './fleet'

const [activeNodeId, setActiveNodeIdSignal] = createSignal<string | null>(null)

export { activeNodeId }

export function setActiveNode(nodeId: string | null): void {
  const previous = activeNodeId()
  if (previous === nodeId) return
  setActiveNodeIdSignal(nodeId)
  // Announced, not performed here: which module signals hold node-scoped state is a composition question
  // (apps/desktop's scopedEviction.ts owns the list, the same way it owns task archival's ten evictors),
  // and client-core must not import a plugin's store to clear it.
  //
  // Emitted AFTER the signal so a listener reads the new node, but before the QueryClient provider
  // remounts — the provider is keyed on `activeCacheId()`, and Solid flushes that on the next tick.
  clientEvents.emit('runtime:node-switched', { from: previous, to: nodeId })
}

// Which cache partition the mounted provider uses (node/fleet.ts). Not the same thing as
// `activeNodeId`: there is no nodeId at all when the origin IS the node, and that mode still needs a
// stable IndexedDB key.
export const activeCacheId = (): string => activeNodeId() ?? ORIGIN_NODE_ID

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
    await refreshFleet()
    // Keep a still-known selection: Settings → Nodes calls this after a mutation, and re-homing the
    // window onto the local node every time the owner renames a remote one would be a bug.
    const selected = activeNodeId()
    // Otherwise prefer the home node (the bundled local one) — `homeNode` is the single definition of
    // that preference, shared with the prefs divergence in queries.ts.
    const node = (selected && nodes().some((n) => n.nodeId === selected) ? selected : homeNode()?.nodeId) ?? null
    if (!node) {
      // Clear the selection as well as the readiness. `readiness !== 'ready' ⇒ no active node` has to
      // hold locally: otherwise removing the last node in Settings → Nodes would leave apiClient
      // ambiently addressed at a node that is gone, relying on NodeGate to be the only thing standing
      // between that and a request.
      setActiveNode(null)
      setNodeReadiness({ kind: 'unpaired' })
      return
    }
    setActiveNode(node)
    setNodeReadiness({ kind: 'ready' })
  } catch (error) {
    setNodeReadiness({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) })
  }
}
