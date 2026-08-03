import { z } from 'zod'

// The vNext wire protocol version. Bumped on breaking change; the Node reports it at GET /v2/node
// and a client showing a major mismatch disables that node rather than negotiating capabilities
// (docs/vNext/protocol.md § Versioning). V1's cookie/`/api` transport was version 1.
export const NODE_PROTOCOL_VERSION = 2

// `node.json` in the data root: a Node's durable identity. Written once on first start and never
// rewritten except for `port`, which records the last successfully bound listener port so a restart
// usually lands back on the same one (docs/vNext/data.md).
export const nodeIdentitySchema = z.strictObject({
  nodeId: z.string().uuid(),
  createdAt: z.number().int().positive(),
  protocolVersion: z.number().int().positive(),
  // Absent until the first successful bind. 0 is never persisted — it means "pick an ephemeral port".
  port: z.number().int().min(1).max(65535).optional(),
})

export type NodeIdentity = z.infer<typeof nodeIdentitySchema>

// GET /v2/node. Unauthenticated it carries only what pairing needs — which protocol to speak and
// which certificate to expect; `nodeId`/`appVersion` appear only for an authenticated caller
// (docs/vNext/protocol.md § Versioning), because anything that can reach the port can read the
// unauthenticated form.
//
// `fingerprint` is the sha256 of the node's self-signed certificate (lowercase hex). Always present:
// the listener is TLS unconditionally, and an optional pin is a pin that silently is not one.
export type NodeInfo = {
  protocolVersion: number
  fingerprint: string
  nodeId?: string
  appVersion?: string
}

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
export type PairedDevice = {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number | null
  revokedAt: number | null
}

export type PairResult = { deviceToken: string; nodeId: string; device: PairedDevice }
export type DevicesResponse = { devices: PairedDevice[] }
// POST /v2/core/pair/start: the code the node displays (QR + text) and how long it lives.
export type PairingWindow = { code: string; expiresInMs: number }
