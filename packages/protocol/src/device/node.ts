import { z } from 'zod'
import { ACORN_BASELINE } from '../baseline.ts'

// The current wire protocol version, and the whole of the client to node compatibility contract. See
// docs/api-reference/versioning.md § Versioning.
export const NODE_PROTOCOL_VERSION = 1

declare const __ACORN_BUILD__: string | undefined
// Which build this bundle is, stamped by its bundler (scripts/buildVersion.mts). The Node reports its
// own at GET /v1/node, and Settings → Nodes compares it with the client's. Source run from a checkout,
// as `pnpm dev:node` and the test runners do, has no stamp.
export const SOURCE_BUILD = 'development'
export const ACORN_BUILD: string = typeof __ACORN_BUILD__ === 'undefined' ? SOURCE_BUILD : __ACORN_BUILD__

// The attachment record: who this node enrolled with, when, and under which enrollment token. One
// optional object on `node.json`, and the only thing a control plane leaves behind on a node
// (docs/node-enrollment.md).
//
// Not a table, and not a second identity. A detached node loses this record and nothing else, which
// is what makes "a detached node keeps working" true by construction rather than by care.
const nodeAttachmentSchema = z.strictObject({
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
// docs/data-layer/data-root.md § `node.json` for why its schema tolerates unknown keys and carries no
// protocol version.
export const nodeIdentitySchema = z.object({
  baseline: z.literal(ACORN_BASELINE),
  nodeId: z.string().uuid(),
  createdAt: z.number().int().positive(),
  // Absent until the first successful bind. 0 is never persisted: it means "pick an ephemeral port".
  port: z.number().int().min(1).max(65535).optional(),
  // The host(s) this node answers to besides loopback, comma-separated. Set once, when the operator
  // confirms it on first boot (`confirmAdvertiseHost`). Its presence is what makes the listener bind
  // beyond 127.0.0.1, so it records an exposure decision rather than a cached lookup. The empty
  // string is a real answer meaning "loopback only, stop asking".
  advertiseHost: z.string().optional(),
  // Who this node is attached to, if anyone. Absent on every install that never enrolled, which is
  // all of them by default (docs/security/control-plane.md § The control plane).
  attachment: nodeAttachmentSchema.optional(),
  // Why the last enrollment attempt failed. Kept apart from `attachment` because the two are
  // different facts: an attached node with a stale error is normal, and a node that tried and failed
  // has no attachment at all but must still be able to say so. A failed enrollment is a visible
  // state, never a boot that hangs.
  enrollmentError: z.strictObject({ at: z.number().int().positive(), reason: z.string() }).optional(),
  // The relay this Node dials out to, and the credential it proves itself with (docs/relay.md). Set
  // by hand; ACORN_RELAY_URL and ACORN_RELAY_CREDENTIAL win over it. Absent means no relay code runs.
  relay: z.strictObject({ url: z.string().url(), credential: z.string().min(1) }).optional(),
})

export type NodeIdentity = z.infer<typeof nodeIdentitySchema>

// GET /v1/node. See docs/api-reference/versioning.md § Versioning for why this is the most tolerant surface in
// the system and stays additive-forever.
//
// `fingerprint` is the sha256 of the node's self-signed certificate (lowercase hex) and is always
// present: the listener is TLS unconditionally, and an optional pin is a pin that silently is not
// one. `nodeId` appears only for an authenticated caller, because anything that can reach the port
// can read the unauthenticated form.
export const nodeInfoSchema = z.object({
  baseline: z.literal(ACORN_BASELINE),
  protocolVersion: z.number().int().positive(),
  fingerprint: z.string().min(1),
  nodeId: z.string().optional(),
  // The Node's `ACORN_BUILD`, for an authenticated caller only, so an unpaired caller can't read which
  // build to attack. A client shows it rather than acting on it: builds within one major interoperate.
  buildVersion: z.string().optional(),
  // Additive opt-in, rather than a protocol major change. Absence means the raw event transport.
  eventTransport: z.object({ viewers: z.number().int().positive().optional() }).optional().catch(undefined),
  // Present only on a CLI-owned background process and only to an authenticated caller. This
  // instance nonce lets lifecycle commands reject a stale PID/record after the root is reopened.
  serviceInstanceId: z.string().uuid().optional(),
})

export type NodeInfo = z.infer<typeof nodeInfoSchema>

// POST /v1/pair. Validated with zod rather than hand-checked because this is the one route an
// unpaired caller can reach: unknown fields are rejected (strictObject) and the lengths are bounded
// before the code ever reaches the pairing window.
export const pairRequestSchema = z.strictObject({
  code: z.string().min(1).max(256),
  deviceName: z.string().min(1).max(120),
})

// A paired device as the owner sees it. Never carries the token or its hash: the raw token is
// returned exactly once, in `PairResult`. See docs/api-reference/transport.md § Pairing.
//
// Not strict for the same reason `pairResultSchema` is not: it is nested inside that response, so a
// strict device object would break the handshake just as surely as a strict envelope around it.
const pairedDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int().nullable(),
  revokedAt: z.number().int().nullable(),
})
export type PairedDevice = z.infer<typeof pairedDeviceSchema>

// The other half of the handshake. See docs/api-reference/versioning.md § Versioning for why it is tolerant: a
// client that pairs successfully and then refuses the answer because it grew a field is a client that
// cannot be upgraded past.
export const pairResultSchema = z.object({
  baseline: z.literal(ACORN_BASELINE),
  deviceToken: z.string().min(1),
  nodeId: z.string().min(1),
  device: pairedDeviceSchema,
})
export type PairResult = z.infer<typeof pairResultSchema>
export type DevicesResponse = { devices: PairedDevice[] }
// POST /v1/core/pair/start: the code the node displays (QR + text) and how long it lives.
export type PairingWindow = { code: string; expiresInMs: number }

// Pairing by approval (docs/api-reference/transport.md § Pairing by approval). A client on the Node's
// own computer asks, the owner allows it from a paired client, and the asker collects its token.
//
// POST /v1/pair/requests. Strict and bounded like `pairRequestSchema`: an unpaired caller sends it.
export const pairingAskSchema = z.strictObject({ deviceName: z.string().min(1).max(120) })
// Its answer. `secret` is what collects the token, so it travels only in bodies, never in a path a
// log could keep. `phrase` is what the owner's dialog shows too.
export type PairingAsk = { secret: string; phrase: string; expiresInMs: number }

// POST /v1/pair/requests/claim.
export const pairingClaimSchema = z.strictObject({ secret: z.string().min(1).max(256) })
// 202 while the owner hasn't answered. An approval answers 200 with a `PairResult`, and a refusal,
// an expiry, and a secret the Node doesn't know all answer the same 401 `pairing_failed`.
export type PairingClaimPending = { status: 'pending' }

// GET /v1/core/pair/requests: what the owner's dialog shows. One request at a time, like a code.
export type PairingRequest = { id: string; deviceName: string; phrase: string; expiresAt: number }
export type PairingRequestResponse = { request: PairingRequest | null }

// POST /v1/core/pair/requests/:id.
export const pairingDecisionSchema = z.strictObject({ decision: z.enum(['allow', 'deny']) })
export type PairingDecision = z.infer<typeof pairingDecisionSchema>

// POST /v1/core/node/stop (docs/cli/local-service.md § Stop and restart). No body is a plain stop.
export const nodeStopRequestSchema = z.strictObject({ restart: z.boolean().optional() })
// How a Node exits after a stop that asked for a restart. 75 is EX_TEMPFAIL. `acorn node start
// --foreground` starts the Node again when its child exits with it.
export const NODE_RESTART_EXIT_CODE = 75
