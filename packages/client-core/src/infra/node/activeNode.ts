import { createSignal } from 'solid-js'
import { fleetBridge } from '../platform'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { readLocal, writeLocal } from '../../kit/lib/deviceStorage'
import { homeNode, nodes, ORIGIN_NODE_ID, refreshFleet } from './fleet'

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

// Whether the gate holds the screen, or the shell draws behind it.
//
// Not `nodeReady()`, which is the fleet's answer and now arrives after the first paint. A warm window
// knows which node it talked to last before it has asked anything, and that is enough to draw: the
// persisted cache for that node fills the rail and the panes, and the chip says the node is starting
// (docs/frontend.md § Painting before the node).
//
// Two states still have nothing to draw. A broker that could not answer at all is the diagnostics
// screen, because nothing in the window will work. And a launch with no node to address is the
// onboarding path — a first-ever launch has no cache either, so there is nothing behind the gate but
// an empty shell.
export const nodeGateHolds = (): boolean =>
  nodeReadiness().kind === 'failed' || (activeNodeId() === null && !nodeReady())

// Pick the node this window talks to. Started at boot and not awaited, so the first paint does not
// wait on the round trip; called again when the fleet gains its first node, and by the recovery
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
