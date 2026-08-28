import { z } from 'zod'

// The node-to-control-plane enrollment protocol. See docs/node-enrollment.md for the written
// version, the JSON schema, and the trust argument.
//
// This is a public interface. The moment a third party can write a control plane — which is the
// point of the node-provider seam — the payload below is something strangers build against, so it
// gets a version number of its own rather than riding on NODE_PROTOCOL_VERSION. The two move for
// different reasons: that one is client-to-node, this one is node-to-control-plane, and a control
// plane never speaks the first.
export const ENROLLMENT_PROTOCOL_VERSION = 1

// What the node posts, once, on the first boot where both environment variables are set.
//
// Strict, and deliberately small. Everything here is find-and-vouch metadata (docs/security.md
// § The control plane): how to reach the node, how to recognise it, and one credential for talking
// to it. Nothing about what the node is doing, and nothing that would grow into it — a field
// describing tasks, repositories or runs fails review by inspection.
export const enrollmentRequestSchema = z.strictObject({
  protocolVersion: z.literal(ENROLLMENT_PROTOCOL_VERSION),
  nodeId: z.string().uuid(),
  // Where a client should reach this node. Whatever the node would print in its own banner, so a
  // node behind NAT enrolls with the address it actually answers on or not at all.
  endpoint: z.string().url(),
  // sha256 of the node's self-signed certificate, lowercase hex: the value a client pins. The
  // control plane's whole vouching job is repeating this back to the client honestly.
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  // The durable credential, self-issued by the node (the launcher handshake already does this). The
  // enrollment token that authenticated this request is single-use and short-lived; this one is not.
  // Handing it over is the trust inversion, written down in docs/security.md.
  deviceToken: z.string().min(1),
})
export type EnrollmentRequest = z.infer<typeof enrollmentRequestSchema>

// The acknowledgement. Loose, for the same reason GET /v2/node is the most tolerant surface in the
// system: a node that refuses an otherwise-successful enrollment because the answer grew a field is
// a node no control plane can ever extend.
//
// A 2xx is the acknowledgement. This shape only carries what the node might show its owner.
export const enrollmentResponseSchema = z.object({
  // What the control plane calls itself in the node's own settings. Absent is fine; the URL is
  // already there.
  controlPlaneName: z.string().optional(),
})
export type EnrollmentResponse = z.infer<typeof enrollmentResponseSchema>

// The path the node posts to, appended to ACORN_CONTROL_PLANE_URL.
export const ENROLLMENT_PATH = '/enroll'
