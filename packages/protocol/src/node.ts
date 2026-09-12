import { z } from 'zod'

// The current wire protocol version, and the whole of the client to node compatibility contract. See
// docs/api-reference.md § Versioning.
export const NODE_PROTOCOL_VERSION = 2

// The attachment record: who this node enrolled with, when, and under which enrollment token. One
// optional object on `node.json`, and the only thing a control plane leaves behind on a node
// (docs/node-enrollment.md).
//
// Not a table, and not a second identity. A detached node loses this record and nothing else, which
// is what makes "a detached node keeps working" true by construction rather than by care.
export const nodeAttachmentSchema = z.strictObject({
  controlPlaneUrl: z.string().url(),
  // What the control plane called itself in its acknowledgement, if it said.
  controlPlaneName: z.string().optional(),
  attachedAt: z.number().int().positive(),
  // A non-secret handle for the enrollment token that authenticated the enrollment: the first 12 hex
  // characters of its sha256. The token itself is single-use and never stored. Recording the handle
  // is what lets an owner, or a support conversation, match this row against the provisioning record
  // on the other side.
  enrollmentTokenId: z.string().min(1),
  // The device row the node issued for the control plane. Detaching revokes it, which is the whole
  // reason it is remembered here.
  deviceId: z.string().min(1),
})
export type NodeAttachment = z.infer<typeof nodeAttachmentSchema>

// `node.json` in the data root: a Node's durable identity, written once on first start. See
// docs/data-layer.md § Data root for why its schema tolerates unknown keys and no longer carries a
// protocol version.
export const nodeIdentitySchema = z.object({
  nodeId: z.string().uuid(),
  createdAt: z.number().int().positive(),
  // Absent until the first successful bind. 0 is never persisted: it means "pick an ephemeral port".
  port: z.number().int().min(1).max(65535).optional(),
  // The host(s) this node answers to besides loopback, comma-separated. Set once, when the operator
  // confirms it on first boot (server/transport/advertise.ts). Its presence is what makes the listener bind
  // beyond 127.0.0.1, so it records an exposure decision rather than a cached lookup. The empty
  // string is a real answer meaning "loopback only, stop asking".
  advertiseHost: z.string().optional(),
  // Who this node is attached to, if anyone. Absent on every install that never enrolled, which is
  // all of them by default (docs/security.md § The control plane).
  attachment: nodeAttachmentSchema.optional(),
  // Why the last enrollment attempt failed. Kept apart from `attachment` because the two are
  // different facts: an attached node with a stale error is normal, and a node that tried and failed
  // has no attachment at all but must still be able to say so. A failed enrollment is a visible
  // state, never a boot that hangs.
  enrollmentError: z.strictObject({ at: z.number().int().positive(), reason: z.string() }).optional(),
})

export type NodeIdentity = z.infer<typeof nodeIdentitySchema>

// GET /v2/node. See docs/api-reference.md § Versioning for why this is the most tolerant surface in
// the system and stays additive-forever.
//
// `fingerprint` is the sha256 of the node's self-signed certificate (lowercase hex) and is always
// present: the listener is TLS unconditionally, and an optional pin is a pin that silently is not
// one. `nodeId` appears only for an authenticated caller, because anything that can reach the port
// can read the unauthenticated form.
export const nodeInfoSchema = z.object({
  protocolVersion: z.number().int().positive(),
  fingerprint: z.string().min(1),
  nodeId: z.string().optional(),
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

// A paired device as the owner sees it. Never carries the token or its hash: the raw token is
// returned exactly once, in `PairResult`. See docs/api-reference.md § Pairing.
//
// Not strict for the same reason `pairResultSchema` is not: it is nested inside that response, so a
// strict device object would break the handshake just as surely as a strict envelope around it.
export const pairedDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int().nullable(),
  revokedAt: z.number().int().nullable(),
})
export type PairedDevice = z.infer<typeof pairedDeviceSchema>

// The other half of the handshake. See docs/api-reference.md § Versioning for why it is tolerant: a
// client that pairs successfully and then refuses the answer because it grew a field is a client that
// cannot be upgraded past.
export const pairResultSchema = z.object({
  deviceToken: z.string().min(1),
  nodeId: z.string().min(1),
  device: pairedDeviceSchema,
})
export type PairResult = z.infer<typeof pairResultSchema>
export type DevicesResponse = { devices: PairedDevice[] }
// POST /v2/core/pair/start: the code the node displays (QR + text) and how long it lives.
export type PairingWindow = { code: string; expiresInMs: number }
