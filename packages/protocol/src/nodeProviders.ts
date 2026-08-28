import { z } from 'zod'
import type { ToolRisk } from './api'

// The node-provider wire shapes: what a plugin's provider answers with, and what the client reads
// back off `/v2/core/nodes`. The contribution type itself is node-side
// (@acorn/node-core/server/nodeProviders/registry.ts), because a provider is code and this module
// stays a pure sink.
//
// See docs/plugins.md § Node providers for the seam and docs/architecture-overview.md § The three
// parties for why a provider is the second door into the fleet.

/** Where a provided node is in its life. `provisioning` is the state this exists for: a node being
 *  built has no endpoint yet, and showing it as offline would say the wrong thing about a machine
 *  that is working fine and simply is not finished. */
export const providedNodeStateSchema = z.enum(['provisioning', 'ready', 'stopped', 'failed'])
export type ProvidedNodeState = z.infer<typeof providedNodeStateSchema>

// One node as a provider describes it.
//
// `endpoint` and `fingerprint` are nullable because a node under construction has neither. Adopting
// one requires both, and the host refuses otherwise rather than pairing against a guess.
export const providedNodeSchema = z.strictObject({
  // The control plane's own id for this node, stable no matter which node asked. That stability is
  // what lets two nodes signed into one account list the same cloud nodes, and what makes moving
  // credential custody later renumber nothing (docs/future/phased-review-steps/cloud-guardrails.md
  // rule 5).
  providerNodeId: z.string().min(1),
  // acorn's own id, once the node has booted far enough to have one. Null before that.
  nodeId: z.string().nullable(),
  label: z.string().min(1),
  endpoint: z.string().url().nullable(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  state: providedNodeStateSchema,
})
export type ProvidedNode = z.infer<typeof providedNodeSchema>

/** The four verbs a provider may declare. `list` is not among them because every provider has it. */
export const NODE_LIFECYCLE_VERBS = ['create', 'destroy', 'start', 'stop'] as const
export type NodeLifecycleVerb = (typeof NODE_LIFECYCLE_VERBS)[number]

/** How much confirmation each verb is owed, in the vocabulary `nodeActions` already uses (api.ts's
 *  `ToolRisk`). Core's decision, not the provider's: a provider that could call its own destroy
 *  `read` would be choosing how loudly acorn warns about it. Destroying a node is the most
 *  consequential button in the product, so it sits at the top tier with nothing above it. */
export const NODE_LIFECYCLE_RISK: Record<NodeLifecycleVerb, ToolRisk> = {
  create: 'write',
  start: 'write',
  stop: 'write',
  destroy: 'execute',
}

/** A provider as the client sees it: what it is called, and which verbs it declared. */
export type NodeProviderDescriptor = {
  // Host-qualified `<pluginId>:<providerId>`, minted by the host at registration.
  id: string
  label: string
  verbs: NodeLifecycleVerb[]
}

// `GET /v2/core/nodes`. One provider being unreachable is a line in `failures`, never a failed
// response: the same partial-result posture the client's fan-out takes across nodes
// (docs/architecture-overview.md § Client state and fleet behavior).
export type NodeProvidersResponse = {
  providers: NodeProviderDescriptor[]
  nodes: Array<ProvidedNode & { providerId: string }>
  failures: Array<{ providerId: string; reason: string }>
}

// `POST /v2/core/nodes/adopt`. The renderer names a provider and a node; the answer carries the
// credential, so the desktop host is the only caller (docs/shell.md § Fleet membership).
export const nodeAdoptBodySchema = z.strictObject({
  providerId: z.string().min(1),
  providerNodeId: z.string().min(1),
})
export type NodeAdoptBody = z.infer<typeof nodeAdoptBodySchema>

// Everything the host needs to remember a node, from the node that listed it. `certPem` is absent:
// the host probes the endpoint itself and refuses a certificate whose fingerprint is not the one
// vouched for here, so the provider's claim is checked rather than trusted.
export const nodeAdoptResultSchema = z.object({
  nodeId: z.string().min(1),
  label: z.string().min(1),
  endpoint: z.string().url(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  deviceToken: z.string().min(1),
})
export type NodeAdoptResult = z.infer<typeof nodeAdoptResultSchema>

// `POST /v2/core/nodes/create`. `options` is a provider-specific bag of strings — a region, a size,
// an image — kept opaque here because core has no business knowing a provider's catalogue.
export const nodeCreateRequestSchema = z.strictObject({
  providerId: z.string().min(1),
  label: z.string().min(1).max(120),
  options: z.record(z.string(), z.string()).default({}),
})
export type NodeCreateRequest = z.input<typeof nodeCreateRequestSchema>

// `POST /v2/core/nodes/{destroy,start,stop}`.
export const nodeLifecycleRequestSchema = z.strictObject({
  providerId: z.string().min(1),
  providerNodeId: z.string().min(1),
})
export type NodeLifecycleRequest = z.infer<typeof nodeLifecycleRequestSchema>
