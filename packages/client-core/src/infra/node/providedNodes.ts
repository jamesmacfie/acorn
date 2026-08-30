import { coreNodeLifecycleRoute, coreNodeProvidersRoute } from '@acorn/protocol/api.ts'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import type { NodeLifecycleVerb, NodeProviderDescriptor, NodeProvidersResponse, ProvidedNode } from '@acorn/protocol/nodeProviders.ts'
import { readJson, sendJson } from './apiClient'
import { fleetBridge } from '../platform'
import { createFleetQuery, type FleetResult } from './fanout'
import { refreshFleet } from './fleet'

// Nodes this client's nodes know about, and the four lifecycle verbs (docs/plugins.md § Node
// providers). The client half of the fleet's second door.
//
// Read by fanning out over every reachable node and unioning the answers, not by asking the local
// node. Today one node usually holds the cloud connection, so the two are indistinguishable — which
// is exactly why the shortcut is worth refusing. The day the account credential moves off the local
// node, or a second machine signs into the same account, the fan-out is already what the surface
// does, and `providerNodeId` is stable across whoever answered, so nothing renumbers
// (docs/future/phased-review-steps/cloud-guardrails.md rules 3 and 5).

const PROVIDED_KEY = ['provided-nodes'] as const

/** One provided node, merged. `sourceNodeId` is whichever node listed it, and it is the node the
 *  lifecycle verbs and adoption are asked of. */
export type ProvidedNodeRow = ProvidedNode & {
  providerId: string
  providerLabel: string
  sourceNodeId: string
  /** The node in this client's fleet that is this row, if it has been adopted. */
  adoptedAs: string | null
  /** Which verbs the provider that listed it declared, so the UI offers nothing that does not exist. */
  verbs: NodeLifecycleVerb[]
}

const dedupeKey = (providerId: string, providerNodeId: string): string => `${providerId} ${providerNodeId}`

/** Which fleet row, if any, is this provided node.
 *
 *  Provenance first, `nodeId` second. The provenance match is exact and survives a node that has not
 *  booted far enough to report an acorn id; the `nodeId` fallback catches a node adopted before this
 *  client recorded provenance, and a node paired by hand that a provider also happens to list. */
const adoptedAs = (
  fleet: readonly NodeRecord[],
  row: { providerId: string; providerNodeId: string; nodeId: string | null },
): string | null => {
  const byProvenance = fleet.find(
    (node) => node.provider?.providerId === row.providerId && node.provider.providerNodeId === row.providerNodeId,
  )
  if (byProvenance) return byProvenance.nodeId
  return row.nodeId && fleet.some((node) => node.nodeId === row.nodeId) ? row.nodeId : null
}

/** Merge every node's answer into one list.
 *
 *  Deduped on `providerId` plus `providerNodeId`, in fleet order, so two nodes signed into the same
 *  account show one row rather than two. Fleet order also means the row is stable: whichever node the
 *  client lists first is the one the verbs are asked of, and that does not reshuffle when a node
 *  answers faster. */
export function mergeProvidedNodes(
  result: FleetResult<NodeProvidersResponse>,
  fleet: readonly NodeRecord[],
): ProvidedNodeRow[] {
  const merged = new Map<string, ProvidedNodeRow>()
  for (const answer of result.rows) {
    const byId = new Map<string, NodeProviderDescriptor>(answer.data.providers.map((provider) => [provider.id, provider]))
    for (const node of answer.data.nodes) {
      const key = dedupeKey(node.providerId, node.providerNodeId)
      if (merged.has(key)) continue
      const descriptor = byId.get(node.providerId)
      merged.set(key, {
        ...node,
        providerLabel: descriptor?.label ?? node.providerId,
        verbs: descriptor?.verbs ?? [],
        sourceNodeId: answer.nodeId,
        adoptedAs: adoptedAs(fleet, node),
      })
    }
  }
  return [...merged.values()]
}

/** Every provider that can create a node, and which node to ask. Deduped the same way as the rows:
 *  one provider id is one entry however many nodes report it. */
export function creatableProviders(
  result: FleetResult<NodeProvidersResponse>,
): Array<NodeProviderDescriptor & { sourceNodeId: string }> {
  const seen = new Map<string, NodeProviderDescriptor & { sourceNodeId: string }>()
  for (const answer of result.rows) {
    for (const provider of answer.data.providers) {
      if (!provider.verbs.includes('create') || seen.has(provider.id)) continue
      seen.set(provider.id, { ...provider, sourceNodeId: answer.nodeId })
    }
  }
  return [...seen.values()]
}

/** Every provider that could not be reached, so a fleet surface can say which list is incomplete
 *  rather than quietly showing a shorter one. */
export const providerFailures = (result: FleetResult<NodeProvidersResponse>): NodeProvidersResponse['failures'] =>
  result.rows.flatMap((answer) => answer.data.failures)

/** True when any node has a provider at all. What the fleet surface hides its whole section behind, so
 *  an install with no cloud plugin never mentions provided nodes. */
export const hasNodeProviders = (result: FleetResult<NodeProvidersResponse>): boolean =>
  result.rows.some((answer) => answer.data.providers.length > 0)

/** The reactive read. Every reachable node answers; one without a provider answers an empty list,
 *  which costs one request and keeps the surface honest about where a provider may run. */
export const createProvidedNodes = () =>
  createFleetQuery<NodeProvidersResponse>(
    () => PROVIDED_KEY,
    (nodeId, _dep, signal) => readJson<NodeProvidersResponse>(coreNodeProvidersRoute, { nodeId, signal }),
  )

const jsonBody = (value: unknown) => ({
  headers: { 'content-type': 'application/json' },
  body: { kind: 'bytes' as const, bytes: new TextEncoder().encode(JSON.stringify(value)) },
})

/** Take a provided node into this client's fleet.
 *
 *  The renderer names the provider and the node and nothing else. The host asks `sourceNodeId` for the
 *  endpoint, the fingerprint and the credential, then probes and checks the fingerprint itself, so
 *  there is no version of this call where the renderer supplies connection material. */
export async function adoptProvidedNode(row: ProvidedNodeRow): Promise<NodeRecord> {
  const bridge = fleetBridge()
  if (!bridge) throw new Error('This build cannot adopt nodes.')
  const record = await bridge.adopt({
    sourceNodeId: row.sourceNodeId,
    providerId: row.providerId,
    providerNodeId: row.providerNodeId,
    label: row.label,
  })
  await refreshFleet()
  return record
}

/** `destroy`, `start` and `stop`, asked of the node that listed the provider. Confirmation is the
 *  caller's: the tiers are in `NODE_LIFECYCLE_RISK` and the node confirms nothing, because a
 *  confirmation the node performs is one the owner never saw. */
export async function runNodeLifecycle(verb: 'destroy' | 'start' | 'stop', row: ProvidedNodeRow): Promise<void> {
  await sendJson(coreNodeLifecycleRoute(verb), {
    method: 'POST',
    ...jsonBody({ providerId: row.providerId, providerNodeId: row.providerNodeId }),
    nodeId: row.sourceNodeId,
  })
}

export async function createProvidedNode(target: { providerId: string; sourceNodeId: string }, label: string): Promise<void> {
  await sendJson(coreNodeLifecycleRoute('create'), {
    method: 'POST',
    ...jsonBody({ providerId: target.providerId, label, options: {} }),
    nodeId: target.sourceNodeId,
  })
}
