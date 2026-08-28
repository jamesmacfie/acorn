import { z } from 'zod'

export const nodeFetchBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bytes'), bytes: z.instanceof(Uint8Array) }),
  // Multipart is described rather than pre-encoded: main builds the real FormData, so we never have to
  // hand-roll boundary generation on the renderer side.
  z.strictObject({
    kind: z.literal('form'),
    parts: z.array(
      z.union([
        z.strictObject({ name: z.string().min(1), value: z.string() }),
        z.strictObject({
          name: z.string().min(1),
          filename: z.string().min(1),
          type: z.string(),
          bytes: z.instanceof(Uint8Array),
        }),
      ]),
    ),
  }),
])
export type NodeFetchBody = z.infer<typeof nodeFetchBodySchema>

export const nodeFetchRequestSchema = z.strictObject({
  // Renderer-minted, so an abort can name the in-flight request without main handing back a handle.
  requestId: z.string().min(1),
  // Always node-relative and always absolute-rooted. Main joins it onto the node's endpoint, so a
  // renderer cannot redirect traffic at another host by smuggling in a full URL.
  path: z.string().startsWith('/'),
  method: z.string().min(1).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: nodeFetchBodySchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
})
export type NodeFetchRequest = z.input<typeof nodeFetchRequestSchema>

export const nodeFetchResponseSchema = z.strictObject({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: z.instanceof(Uint8Array),
})
export type NodeFetchResponse = z.infer<typeof nodeFetchResponseSchema>

// docs/architecture-overview.md § Client state and fleet behavior lists exactly these five. A
// fingerprint mismatch is not a sixth: it surfaces as `offline` carrying an `identity_mismatch`
// error, because it is a reason a node is unreachable rather than a distinct steady state.
export const nodeConnectionStateSchema = z.enum(['online', 'degraded', 'offline', 'incompatible', 'revoked'])
export type NodeConnectionState = z.infer<typeof nodeConnectionStateSchema>

export const nodeStatusSchema = z.strictObject({
  nodeId: z.string(),
  state: nodeConnectionStateSchema,
  // Set when the state has a nameable cause the UI must render differently. Above all
  // `identity_mismatch`, which docs/security.md makes a hard stop, never an auto-retrust.
  error: z
    .strictObject({
      code: z.enum(['identity_mismatch', 'unreachable', 'protocol_mismatch', 'unauthorized']),
      presentedFingerprint: z.string().optional(),
    })
    .optional(),
  lastSeenAt: z.number().int().optional(),
})
export type NodeStatus = z.infer<typeof nodeStatusSchema>

// A node the client knows about. Membership is client-side state
// (docs/architecture-overview.md § Client state and fleet behavior), so this is main's record, not
// something a node reports about itself.
export const nodeRecordSchema = z.strictObject({
  nodeId: z.string().min(1),
  label: z.string(),
  endpoint: z.string().url(),
  // Absent for a plain-http local node; present once there is a certificate to pin against.
  fingerprint: z.string().optional(),
  // True for the node this client spawned and supervises. Exactly one, and it cannot be unpaired.
  // Only the app's own data root defines it.
  local: z.boolean(),
  // Where this row came from, when it did not come from probe-then-pair. Present only for a node
  // adopted through a node provider (see `nodeAdoptRequestSchema` below), so the fleet can say which
  // rows vanish if a plugin is disabled and which provider vouched for the one in front of you.
  //
  // Provenance, not authority: the pinned fingerprint is still what the connection is checked
  // against, and it was still confirmed against the certificate the endpoint presented.
  provider: z.strictObject({ providerId: z.string().min(1), providerNodeId: z.string().min(1), sourceNodeId: z.string().min(1) }).optional(),
})
export type NodeRecord = z.infer<typeof nodeRecordSchema>

// --- Owner-initiated fleet mutations ---
//
// Membership is the helper's to change, so the renderer asks. Each of these is Zod-parsed in
// `helperServer.ts` exactly like nodeFetchRequest: cheap, and it removes a whole class of "what if a
// compromised renderer asked for…" reasoning about the files that hold device tokens.
//
// There are two routes into the fleet, and this is the whole of what each requires.
//
// Probe-then-pair, below, is the human one: the owner reads a fingerprint off the node itself and
// confirms it, and no shape here lets a caller skip that by supplying its own token.
//
// Adoption, `nodeAdoptRequestSchema`, is the unattended one, added for provisioned nodes
// (docs/plugins.md § Node providers). It is narrower than it looks: the renderer names a provider and
// a node id, and the host asks the node that listed it for the endpoint, the fingerprint and the
// credential, then probes that endpoint and refuses a certificate whose fingerprint is not the one
// the provider vouched for. So the renderer still cannot introduce a node of its own invention, and
// still never sees a device token. What replaces the owner's eyes is the provider's word, which is
// exactly the trust the owner granted when they connected it.
export const nodeAdoptRequestSchema = z.strictObject({
  // The node whose provider listed this record. Not necessarily the local node: a provider runs on
  // some node, and the fleet read that produced this row fanned out over all of them.
  sourceNodeId: z.string().min(1),
  providerId: z.string().min(1),
  providerNodeId: z.string().min(1),
  // What to call it in this client's fleet. The provider's own label when the caller has nothing
  // better.
  label: z.string().min(1).max(120),
})
export type NodeAdoptRequest = z.infer<typeof nodeAdoptRequestSchema>

export const nodeProbeRequestSchema = z.strictObject({ endpoint: z.string().url() })
export type NodeProbeRequest = z.infer<typeof nodeProbeRequestSchema>

// What the owner is asked to compare against the fingerprint the node itself displays. That
// out-of-band comparison is the security of pairing (docs/api-reference.md § Pairing): reading a
// fingerprint over the very connection being authenticated proves nothing on its own.
//
// The certificate stays in main and is never part of this reply: main remembers the probe, so `pair`
// refers to it rather than round-tripping cert material through the renderer.
export type NodeProbeResult = {
  endpoint: string
  fingerprint: string
  protocolVersion: number
  // False for a protocol major the client cannot speak: the `incompatible` state, decided before
  // pairing rather than after (docs/architecture-overview.md § Client state and fleet behavior).
  compatible: boolean
}

// Completes the probe. No endpoint or fingerprint: pairing against anything other than the endpoint
// whose fingerprint the owner just confirmed would defeat the confirmation.
export const nodePairRequestSchema = z.strictObject({
  code: z.string().min(1).max(256),
  deviceName: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
})
export type NodePairRequest = z.infer<typeof nodePairRequestSchema>

export const nodeRenameRequestSchema = z.strictObject({
  nodeId: z.string().min(1),
  label: z.string().min(1).max(120),
})
export type NodeRenameRequest = z.infer<typeof nodeRenameRequestSchema>

// Unpair vs revoke (docs/authentication.md § Device tokens): `revoke: false` is this client
// forgetting the node, `revoke: true` also asks the node to forget this client. Confusing them loses
// access to a remote node, so the two are one flag on one route rather than two verbs that look alike.
export const nodeForgetRequestSchema = z.strictObject({
  nodeId: z.string().min(1),
  revoke: z.boolean(),
})
export type NodeForgetRequest = z.infer<typeof nodeForgetRequestSchema>

// Opening a preview tunnel (docs/api-reference.md § WebSocket). The renderer names a task and a port
// on the node and gets back a loopback port on this machine, never an endpoint and never a token. The
// pipe itself is main's, like every other byte to or from a node.
export const nodeTunnelRequestSchema = z.strictObject({
  nodeId: z.string().min(1),
  taskId: z.string().min(1),
  port: z.number().int().min(1).max(65535),
})
export type NodeTunnelRequest = z.infer<typeof nodeTunnelRequestSchema>
export type NodeTunnelResult = { port: number }
