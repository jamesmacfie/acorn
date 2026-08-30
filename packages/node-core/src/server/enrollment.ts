import { createHash } from 'node:crypto'
import { ENROLLMENT_PATH, ENROLLMENT_PROTOCOL_VERSION, enrollmentResponseSchema, type EnrollmentRequest } from '@acorn/protocol/enrollment.ts'
import type { AppDatabase } from './db'
import type { DeviceService } from './auth/deviceTokens'
import { recordAudit } from './audit'
import { readNodeAttachment, recordEnrollmentFailure, recordNodeAttachment } from './storage/dataRoot'

// Unattended enrollment: the node introduces itself to a control plane that provisioned it
// (docs/node-enrollment.md).
//
// The inversion is the whole idea. Ordinary pairing has the node mint a code and a human carry it to
// a client. A node in a data centre has no human beside it, so the provisioner mints a token before
// the node exists and passes it in through the environment. The node then hands the control plane a
// durable credential for itself, which is why docs/security.md says trusting your control plane is
// the whole game.
//
// Two properties this file exists to keep true:
//
//   With neither variable set, none of this runs. Not "runs and does nothing" — `enrollNode` returns
//   before it reads a file, so an existing install is byte-for-byte unchanged.
//
//   A failure is recorded and visible, never a boot that hangs. Bounded attempts, a per-attempt
//   timeout, and the reason written where GET /v2/core/attachment can show it.

// Three attempts inside roughly fifteen seconds. Enough to ride out a control plane still coming up
// beside a freshly provisioned node, short enough that nobody would call it a hang. A node that fails
// all three boots normally and says so; retrying forever would trade a visible failure for an
// invisible one.
const ATTEMPTS = 3
const ATTEMPT_TIMEOUT_MS = 5_000
const BACKOFF_MS = [1_000, 3_000]
const backoffFor = (attempt: number): number => BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]!

export type EnrollmentOutcome =
  | { kind: 'skipped'; reason: 'unconfigured' | 'already-attached' }
  | { kind: 'enrolled'; controlPlaneUrl: string }
  | { kind: 'failed'; reason: string }

export type EnrollmentEnv = {
  ACORN_ENROLLMENT_TOKEN?: string | undefined
  ACORN_CONTROL_PLANE_URL?: string | undefined
}

export type EnrollmentDeps = {
  dataDir: string
  nodeId: string
  // What a client should dial, and what this node pins. Both are only known once the listener has
  // bound, which is why enrollment happens after the listener rather than at the top of boot.
  endpoint: string
  fingerprint: string
  devices: DeviceService
  db: AppDatabase
  env?: EnrollmentEnv
  // Injected for the tests, which run against a stub control plane rather than a real one.
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

/** A non-secret handle for an enrollment token: the first 12 hex characters of its sha256.
 *
 *  No token format is imposed. A control plane mints whatever it likes and this still yields a stable
 *  id both sides can match a record on, which matters because the format is the one part of this
 *  protocol a third party would otherwise have to copy from us. */
export const enrollmentTokenId = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 12)

/** Is this a control-plane URL worth posting a durable credential to?
 *
 *  There is deliberately no allowlist of permitted control planes: whoever set the environment
 *  variable made that decision (the extensibility review says so in as many words). The scheme is a
 *  different question. Plain http off this machine would put the device token on the wire in the
 *  clear, so it is refused; loopback http stays allowed because that is what a test stub and a local
 *  development control plane are. */
export function checkControlPlaneUrl(raw: string): { url: URL } | { reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { reason: `ACORN_CONTROL_PLANE_URL is not a URL: ${raw}` }
  }
  if (url.protocol === 'https:') return { url }
  if (url.protocol !== 'http:') return { reason: `ACORN_CONTROL_PLANE_URL must be http or https, not ${url.protocol}` }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1'
  if (loopback) return { url }
  return { reason: `ACORN_CONTROL_PLANE_URL must use https for a host other than loopback (got ${raw})` }
}

const enrollmentUrl = (base: URL): string => new URL(`${base.pathname.replace(/\/$/, '')}${ENROLLMENT_PATH}`, base).toString()

/** One attempt. Resolves with the acknowledgement, or throws with something worth writing down. */
async function post(url: string, token: string, body: EnrollmentRequest, fetchImpl: typeof fetch): Promise<{ controlPlaneName?: string }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${response.status} from ${url}`)
  // Tolerant on the way back in (protocol/enrollment.ts): an unparseable body still leaves a node
  // that enrolled successfully, so take what parses and ignore the rest.
  const parsed = enrollmentResponseSchema.safeParse(await response.json().catch(() => ({})))
  return parsed.success ? parsed.data : {}
}

export async function enrollNode(deps: EnrollmentDeps): Promise<EnrollmentOutcome> {
  const env = deps.env ?? process.env
  const token = env.ACORN_ENROLLMENT_TOKEN?.trim()
  const controlPlane = env.ACORN_CONTROL_PLANE_URL?.trim()
  // The unconfigured path, and it comes first on purpose: no file read, no database write, no log
  // line. This is the branch every existing install takes.
  if (!token && !controlPlane) return { kind: 'skipped', reason: 'unconfigured' }

  const fail = (reason: string): EnrollmentOutcome => {
    console.warn(`[enrollment] ${reason}`)
    recordEnrollmentFailure(deps.dataDir, reason)
    recordAudit(deps.db, { actor: 'system', action: 'node.enrolled', details: { ok: false, reason } })
    return { kind: 'failed', reason }
  }

  // One variable without the other is a provisioning mistake, not a request to skip. Saying so beats
  // booting a node that looks fine and is attached to nothing.
  if (!token || !controlPlane) {
    return fail('set both ACORN_ENROLLMENT_TOKEN and ACORN_CONTROL_PLANE_URL, or neither')
  }
  // First boot only. The enrollment token is single-use by contract, so a second attempt would
  // present a spent secret and, if it somehow succeeded, hand out a second credential for a node that
  // already has an owner. Re-attaching is a detach followed by a fresh token.
  if (readNodeAttachment(deps.dataDir).attachment) return { kind: 'skipped', reason: 'already-attached' }

  const checked = checkControlPlaneUrl(controlPlane)
  if ('reason' in checked) return fail(checked.reason)
  const url = enrollmentUrl(checked.url)

  // A credential of its own, not the launcher's. It is separately revocable, which is what makes
  // "detach revokes the device row" a real thing rather than a phrase, and it means the audit trail
  // names the control plane as a paired device like any other.
  const device = await deps.devices.issue(`Control plane (${checked.url.host})`)
  const body: EnrollmentRequest = {
    protocolVersion: ENROLLMENT_PROTOCOL_VERSION,
    nodeId: deps.nodeId,
    endpoint: deps.endpoint,
    fingerprint: deps.fingerprint,
    deviceToken: device.token,
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastError = 'no attempt was made'
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffFor(attempt))
    try {
      const ack = await post(url, token, body, fetchImpl)
      recordNodeAttachment(deps.dataDir, {
        controlPlaneUrl: checked.url.toString(),
        ...(ack.controlPlaneName ? { controlPlaneName: ack.controlPlaneName } : {}),
        attachedAt: Date.now(),
        enrollmentTokenId: enrollmentTokenId(token),
        deviceId: device.device.id,
      })
      recordAudit(deps.db, {
        actor: 'system',
        action: 'node.enrolled',
        subject: device.device.id,
        details: { ok: true, controlPlaneUrl: checked.url.toString(), enrollmentTokenId: enrollmentTokenId(token) },
      })
      console.log(`[enrollment] attached to ${checked.url.host}`)
      return { kind: 'enrolled', controlPlaneUrl: checked.url.toString() }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  // Nobody holds this token, so leaving it valid would be a standing credential for a machine that
  // failed to hand it over. Best-effort: the failure being recorded matters more than the cleanup.
  await deps.devices.revoke(device.device.id).catch(() => {})
  return fail(`could not enroll with ${checked.url.host} after ${ATTEMPTS} attempts: ${lastError}`)
}
