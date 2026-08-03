import { z } from 'zod'

// The renderer↔main contract for reaching a node (docs/vNext/architecture.md § How the client talks
// to nodes).
//
// The renderer never talks to a node directly. It calls `nodeFetch(nodeId, req)` and main performs
// the real HTTPS with the pinned certificate and the device token, so certificate pinning is a
// four-line comparison in Node rather than a fight with Chromium's cert store, and the token stays
// in main + the OS keychain where the renderer cannot read it.
//
// This inverts the invariant preload.ts used to state ("every request/response verb is HTTP; every
// stream is the WebSocket"): both now ride IPC. The upside is that the renderer needs no network
// permission at all, which is what lets its CSP say `connect-src 'self'`.

// Bodies cross IPC as bytes because that is the one representation structured-clone carries losslessly
// for JSON, text and binary alike. A zero-length body is how a 204 arrives — which is the whole reason
// the renderer's raw-fetch escape hatches existed.
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

// docs/vNext/architecture.md § Fleet semantics lists exactly these five. A fingerprint mismatch is
// deliberately NOT a sixth: it surfaces as `offline` carrying an `identity_mismatch` error, because it
// is a reason a node is unreachable rather than a distinct steady state.
export const nodeConnectionStateSchema = z.enum(['online', 'degraded', 'offline', 'incompatible', 'revoked'])
export type NodeConnectionState = z.infer<typeof nodeConnectionStateSchema>

export const nodeStatusSchema = z.strictObject({
  nodeId: z.string(),
  state: nodeConnectionStateSchema,
  // Set when the state has a nameable cause the UI must render differently — above all
  // `identity_mismatch`, which docs/vNext/security.md makes a hard stop, never an auto-retrust.
  error: z
    .strictObject({
      code: z.enum(['identity_mismatch', 'unreachable', 'protocol_mismatch', 'unauthorized']),
      presentedFingerprint: z.string().optional(),
    })
    .optional(),
  lastSeenAt: z.number().int().optional(),
})
export type NodeStatus = z.infer<typeof nodeStatusSchema>

// A node the client knows about. Membership is client-side state (architecture.md § What runs where),
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
