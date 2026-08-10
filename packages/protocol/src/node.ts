import { z } from 'zod'

// The current wire protocol version. Bumped on breaking change; the Node reports it at GET /v2/node
// and a client showing a major mismatch disables that node rather than negotiating capabilities
// (docs/api-reference.md § Versioning).
export const NODE_PROTOCOL_VERSION = 2

// `node.json` in the data root: a Node's durable identity. Written once on first start and never
// rewritten except for `port`, which records the last successfully bound listener port so a restart
// usually lands back on the same one (docs/data-layer.md).
export const nodeIdentitySchema = z.strictObject({
  nodeId: z.string().uuid(),
  createdAt: z.number().int().positive(),
  protocolVersion: z.number().int().positive(),
  // Absent until the first successful bind. 0 is never persisted — it means "pick an ephemeral port".
  port: z.number().int().min(1).max(65535).optional(),
  // The host(s) this node answers to besides loopback, comma-separated — set once, when the operator
  // confirms it on first boot (main/advertise.ts). Its presence is what makes the listener bind
  // beyond 127.0.0.1, so it is a deliberate record of an exposure decision, not a cache of a lookup.
  // The empty string is a real answer meaning "loopback only, stop asking".
  advertiseHost: z.string().optional(),
})

export type NodeIdentity = z.infer<typeof nodeIdentitySchema>

// GET /v2/node. Unauthenticated it carries only what pairing needs — which protocol to speak and
// which certificate to expect; `nodeId`/`appVersion` appear only for an authenticated caller
// (docs/api-reference.md § Versioning), because anything that can reach the port can read the
// unauthenticated form.
//
// `fingerprint` is the sha256 of the node's self-signed certificate (lowercase hex). Always present:
// the listener is TLS unconditionally, and an optional pin is a pin that silently is not one.
export const nodeInfoSchema = z.strictObject({
  protocolVersion: z.number().int().positive(),
  fingerprint: z.string().min(1),
  nodeId: z.string().optional(),
  appVersion: z.string().optional(),
})

export type NodeInfo = z.infer<typeof nodeInfoSchema>

// POST /v2/pair. Validated with zod rather than hand-checked because this is the one route an
// unpaired caller can reach: unknown fields are rejected (strictObject) and the lengths are bounded
// before the code ever reaches the pairing window.
export const pairRequestSchema = z.strictObject({
  code: z.string().min(1).max(256),
  deviceName: z.string().min(1).max(120),
})
export type PairRequest = z.infer<typeof pairRequestSchema>

// A paired device as the owner sees it. Never carries the token or its hash — the raw token is
// returned exactly once, in PairResult.
export const pairedDeviceSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int().nullable(),
  revokedAt: z.number().int().nullable(),
})
export type PairedDevice = z.infer<typeof pairedDeviceSchema>

export const pairResultSchema = z.strictObject({
  deviceToken: z.string().min(1),
  nodeId: z.string().min(1),
  device: pairedDeviceSchema,
})
export type PairResult = z.infer<typeof pairResultSchema>
export type DevicesResponse = { devices: PairedDevice[] }
// POST /v2/core/pair/start: the code the node displays (QR + text) and how long it lives.
export type PairingWindow = { code: string; expiresInMs: number }
