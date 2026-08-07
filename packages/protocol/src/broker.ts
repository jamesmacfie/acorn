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

// docs/architecture-overview.md § Fleet semantics lists exactly these five. A fingerprint mismatch is
// deliberately NOT a sixth: it surfaces as `offline` carrying an `identity_mismatch` error, because it
// is a reason a node is unreachable rather than a distinct steady state.
export const nodeConnectionStateSchema = z.enum(['online', 'degraded', 'offline', 'incompatible', 'revoked'])
export type NodeConnectionState = z.infer<typeof nodeConnectionStateSchema>

export const nodeStatusSchema = z.strictObject({
  nodeId: z.string(),
  state: nodeConnectionStateSchema,
  // Set when the state has a nameable cause the UI must render differently — above all
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

// A node the client knows about. Membership is client-side state (docs/architecture-overview.md § What runs where),
// so this is main's record, not something a node reports about itself.
export const nodeRecordSchema = z.strictObject({
  nodeId: z.string().min(1),
  label: z.string(),
  endpoint: z.string().url(),
  // Absent for a plain-http local node; present once there is a certificate to pin against.
  fingerprint: z.string().optional(),
  // True for the node this client spawned and supervises. Exactly one, and it cannot be unpaired —
  // only the app's own data root defines it.
  local: z.boolean(),
})
export type NodeRecord = z.infer<typeof nodeRecordSchema>

// --- Owner-initiated fleet mutations ---
//
// Membership is main's to change, so the renderer asks. Each of these is Zod-parsed in
// nodeBrokerIpc.ts exactly like nodeFetchRequest: cheap, and it removes a whole class of "what if a
// compromised renderer asked for…" reasoning about the files that hold device tokens.
//
// There is deliberately no "add this node with this token" shape. The only route into the fleet is
// probe-then-pair, which is what forces the fingerprint confirmation to happen.

export const nodeProbeRequestSchema = z.strictObject({ endpoint: z.string().url() })
export type NodeProbeRequest = z.infer<typeof nodeProbeRequestSchema>

// What the owner is asked to compare against the fingerprint the node itself displays. That
// out-of-band comparison IS the security of pairing (docs/api-reference.md § Pairing) — reading a
// fingerprint over the very connection being authenticated proves nothing on its own.
//
// The certificate stays in main and is never part of this reply: main remembers the probe, so `pair`
// refers to it rather than round-tripping cert material through the renderer.
export type NodeProbeResult = {
  endpoint: string
  fingerprint: string
  protocolVersion: number
  // False for a protocol major the client cannot speak — the `incompatible` state, decided before
  // pairing rather than after (docs/architecture-overview.md § Fleet semantics).
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

// Unpair vs revoke, the distinction docs/ui-design.md § Node management insists is labeled: `revoke: false` is
// this client forgetting the node, `revoke: true` also asks the node to forget this client. Confusing
// them loses access to a remote node, so the two are one flag on one route rather than two verbs that
// look alike.
export const nodeForgetRequestSchema = z.strictObject({
  nodeId: z.string().min(1),
  revoke: z.boolean(),
})
export type NodeForgetRequest = z.infer<typeof nodeForgetRequestSchema>

// Opening a preview tunnel (docs/api-reference.md § Streams). The renderer names a task and a port on the
// node and gets back a LOOPBACK port on this machine — never an endpoint, never a token. The pipe itself is
// main's, like every other byte to or from a node.
export const nodeTunnelRequestSchema = z.strictObject({
  nodeId: z.string().min(1),
  taskId: z.string().min(1),
  port: z.number().int().min(1).max(65535),
})
export type NodeTunnelRequest = z.infer<typeof nodeTunnelRequestSchema>
export type NodeTunnelResult = { port: number }
