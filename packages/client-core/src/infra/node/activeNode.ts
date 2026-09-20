import { createSignal } from 'solid-js'
import { fleetBridge } from '../platform'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { readLocal, writeLocal } from '../../kit/lib/deviceStorage'
import { homeNode, nodeIsStarting, nodes, ORIGIN_NODE_ID, refreshFleet } from './fleet'

// The node this window talked to last, remembered on the device so the next launch has one before the
// fleet answers.
//
// It has to be readable synchronously, because it picks the query cache's partition
// (`activeCacheId()` below, node/fleet.ts § clientFor) and the window now renders before anything has
// asked the helper anything (docs/performance.md § Every host draws first). Reading
// it a tick late would mount the shell on the `origin` partition and then remount it on the real one,
// which is a flash and a thrown-away first paint.
//
// Device state, and a hint rather than a fact: it says which machine's window this is, not anything
// about a node's data (docs/state-ownership.md § Scope rules). `selectActiveNode` below corrects it
// against the fleet, and a node that has gone reaches the `node-replaced` reload.
const LAST_NODE_KEY = 'acorn.last-node'

const [activeNodeId, setActiveNodeIdSignal] = createSignal<string | null>(readLocal(LAST_NODE_KEY))

export { activeNodeId }

export function setActiveNode(nodeId: string | null): void {
  const previous = activeNodeId()
  if (previous === nodeId) return
  setActiveNodeIdSignal(nodeId)
  // Before the event below, so a listener that reads the device's answer back gets this one.
  writeLocal(LAST_NODE_KEY, nodeId ?? '')
  // Announced, not performed here: which module signals hold node-scoped state is a composition question
  // (apps/desktop's scopedEviction.ts owns the list), and client-core must not import a plugin's store to
  // clear it.
  //
  // Emitted after the signal so a listener reads the new node, but before the QueryClient provider
  // remounts: the provider is keyed on `activeCacheId()`, and Solid flushes that on the next tick.
  clientEvents.emit('runtime:node-switched', { from: previous, to: nodeId })
}

// Which cache partition the mounted provider uses (node/fleet.ts). Not the same as `activeNodeId`:
// there's no nodeId at all when the origin is the node, and that mode still needs a stable IndexedDB key.
export const activeCacheId = (): string => activeNodeId() ?? ORIGIN_NODE_ID

export type NodeReadiness =
  | { kind: 'starting' } // asking the broker for the fleet — the bundled local node's whole story
  | { kind: 'ready' } // a node is selected, or the serving origin IS the node (see below)
  | { kind: 'unpaired' } // the broker knows no nodes: nothing to talk to until the owner pairs one
  | { kind: 'failed'; reason: string } // the broker itself could not answer

const [nodeReadiness, setNodeReadiness] = createSignal<NodeReadiness>({ kind: 'starting' })

export { nodeReadiness }

export const nodeReady = (): boolean => nodeReadiness().kind === 'ready'

/** The selected node is the supervised local process and has not reported a connection state yet. */
export const activeNodeStarting = (): boolean => {
  const nodeId = activeNodeId()
  return nodeId !== null && nodeIsStarting(nodeId)
}

// Whether the gate holds the screen, or the shell draws behind it.
//
// The helper and the remembered cache partition are ready before the local node process is. The shell
// used to draw that cache immediately, which let pane-owned resources fail before their routes
// existed. Hold the existing loader through fleet selection and through the local node's first broker
// status instead. A remote node that is offline, or a node that disconnects after it has reported,
// still draws the cached shell with its ordinary connection state.
export const nodeGateHolds = (): boolean => {
  const readiness = nodeReadiness().kind
  return readiness === 'starting' || readiness === 'failed' || readiness === 'unpaired' || activeNodeStarting()
}

// Pick the node this window talks to. Started at boot and not awaited, so the startup loader can paint
// during the round trip; called again when the fleet gains its first node, and by the recovery
// screen's Retry, which is what makes `starting` a state the user can observe.
export async function selectActiveNode(): Promise<void> {
  const bridge = fleetBridge()
  // No broker at all: the renderer is being served by a node directly (`dev:node` in a browser), so the
  // origin already is the node and apiClient's same-origin fallback covers it. Gating the shell on a
  // selection would leave that mode staring at the recovery screen forever.
  if (!bridge) {
    setNodeReadiness({ kind: 'ready' })
    return
  }

  setNodeReadiness({ kind: 'starting' })
  try {
    await refreshFleet()
    // Keep a still-known selection: Settings → Nodes calls this after a mutation, and re-homing the
    // window onto the local node every time the owner renames a remote one would be a bug.
    const selected = activeNodeId()
    // Otherwise prefer the home node, the bundled local one. `homeNode` is the single definition of that
    // preference, shared with the prefs divergence in queries.ts.
    const node = (selected && nodes().some((n) => n.nodeId === selected) ? selected : homeNode()?.nodeId) ?? null
    if (!node) {
      // Clear the selection as well as the readiness. "not ready implies no active node" has to hold
      // locally, or removing the last node in Settings → Nodes would leave apiClient ambiently addressed
      // at a node that's gone, relying on NodeGate to be the only thing standing between that and a
      // request.
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
