import { z } from 'zod'

// The current wire protocol version, and the whole of the client↔node compatibility contract
// (docs/api-reference.md § Versioning). One number, one meaning: it is the protocol MAJOR, each side
// refuses a major it does not speak, and within a major every change is additive.
//
// Bumped on breaking change; the Node reports it at GET /v2/node, the pairing probe refuses a mismatch
// before pairing and the broker refuses one on every connect after it.
//
// Why the rule is this blunt: today the client and the node ship together, so any wire change is safe
// and none of this costs anything. The day a node is a download (docs/future/bundle.md) old nodes exist
// forever and that freedom is gone — so the contract is written down now, while it is free, rather than
// negotiated later against installed software.
export const NODE_PROTOCOL_VERSION = 2

// `node.json` in the data root: a Node's durable identity. Written once on first start and never
// rewritten except for `port`, which records the last successfully bound listener port so a restart
// usually lands back on the same one (docs/data-layer.md).
//
// Not strict, and that is load-bearing rather than lax: this file is written by whichever version of
// acorn created the root and read by every version after it, so it has exactly the skew problem the
// wire has. It used to carry `protocolVersion`, written at first boot and read by nothing ever — under
// `strictObject`, dropping the field would have made every existing node.json unparseable and every
// existing data root unopenable. Unknown keys are ignored so a field can always be retired.
export const nodeIdentitySchema = z.object({
  nodeId: z.string().uuid(),
  createdAt: z.number().int().positive(),
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
// which certificate to expect; `nodeId` appears only for an authenticated caller, because anything
// that can reach the port can read the unauthenticated form.
//
// `fingerprint` is the sha256 of the node's self-signed certificate (lowercase hex). Always present:
// the listener is TLS unconditionally, and an optional pin is a pin that silently is not one.
//
// THE MOST TOLERANT SURFACE IN THE SYSTEM, and it has to be, in every major forever. This is how a
// client learns it cannot speak to a node — so a client that cannot parse it cannot even say why, and
// reports "this is not an acorn node" about something that plainly is. It was `strictObject`, which
// meant the day any future node added a field here, every older client would have failed exactly that
// way. Additive-forever, never strict, never renamed. Adding a field is always safe; changing or
// removing one is not a major bump, it is a thing you do not do.
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

// A paired device as the owner sees it. Never carries the token or its hash — the raw token is
// returned exactly once, in PairResult.
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

// The other half of the handshake, and tolerant for the same reason: a client that pairs successfully
// and then refuses the answer because it grew a field is a client that cannot be upgraded past.
export const pairResultSchema = z.object({
  deviceToken: z.string().min(1),
  nodeId: z.string().min(1),
  device: pairedDeviceSchema,
})
export type PairResult = z.infer<typeof pairResultSchema>
export type DevicesResponse = { devices: PairedDevice[] }
// POST /v2/core/pair/start: the code the node displays (QR + text) and how long it lives.
export type PairingWindow = { code: string; expiresInMs: number }
