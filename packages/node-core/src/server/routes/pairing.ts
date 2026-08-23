import { Hono, type Context } from 'hono'
import {
  NODE_PROTOCOL_VERSION,
  pairRequestSchema,
  type DevicesResponse,
  type NodeInfo,
  type PairingWindow,
  type PairResult,
} from '@acorn/protocol/node.ts'
import { auditActor, auditRequest } from '../auditRequest'
import { PAIRING_WINDOW_MS } from '../auth/pairingCodes'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Pairing and device management (docs/api-reference.md § Pairing, docs/security.md
// § Transport and auth).
//
// Two routers, because they sit on opposite sides of the auth gate. `open` is how a client holding no
// credential gets one, so it mounts above requireUser. `core` is owner-only device administration and
// mounts below it. A pairing route below the gate is unreachable, and a device route above it is an
// unauthenticated hole.

// The pairing window already allows only five attempts, but it can be reopened and each reopen
// refreshes that budget. This ceiling bounds the churn, so a caller that reaches the port cannot spend
// the day guessing across reopened windows.
//
// Not a general rate limiter and not keyed by caller: one counter on one route. A loopback or LAN
// peer's address is not a trustworthy identity, and keying a map on hostile input allocates without
// bound.
const PAIR_ATTEMPT_WINDOW_MS = 60_000
const PAIR_ATTEMPTS_PER_WINDOW = 20

function attemptCeiling(now: () => number = () => Date.now()): () => boolean {
  let windowStartedAt = 0
  let attempts = 0
  return () => {
    const at = now()
    if (at - windowStartedAt >= PAIR_ATTEMPT_WINDOW_MS) {
      windowStartedAt = at
      attempts = 0
    }
    attempts += 1
    return attempts <= PAIR_ATTEMPTS_PER_WINDOW
  }
}

// The single pairing failure (docs/api-reference.md § Pairing): same status, same code, same message,
// no details. 401 because the request presented a credential and it was rejected.
const pairingFailed = (c: Context<AppEnv>): Response => respondError(c, 401, 'pairing_failed', ['Pairing failed.'])

export function pairingRoutes(): { open: Hono<AppEnv>; core: Hono<AppEnv> } {
  const withinCeiling = attemptCeiling()

  const open = new Hono<AppEnv>()
    .get('/node', (c) => {
      // authMiddleware has already run and resolved the principal without enforcing it, so this can
      // widen the payload for an authenticated caller without a second credential check.
      const authenticated = c.get('principal') !== null
      const info: NodeInfo = {
        protocolVersion: NODE_PROTOCOL_VERSION,
        // The certificate a client pins against (docs/api-reference.md § Pairing). Reading it over the
        // connection being authenticated proves nothing. It is the value the owner compares against
        // the code shown on the node.
        fingerprint: c.env.NODE_FINGERPRINT,
        // This is the one response that must stay readable by every client forever, so the bar for a
        // field on it is a real consumer, not a plausible use. Adding one back is one line and always
        // safe, because the schema is additive forever (protocol/node.ts).
        ...(authenticated ? { nodeId: c.env.NODE_ID } : {}),
      }
      return c.json(info)
    })
    .post('/pair', async (c) => {
      if (!withinCeiling()) return respondError(c, 429, 'rate_limited', ['Too many pairing attempts. Try again shortly.'])
      const parsed = pairRequestSchema.safeParse(await c.req.json().catch(() => null))
      // Short-circuit order is load-bearing: a malformed body never reaches consume(), so it cannot
      // spend one of the window's five attempts, and it still answers with the same error.
      if (!parsed.success || !c.env.PAIRING_CODES.consume(parsed.data.code)) return pairingFailed(c)
      const { token, device } = await c.env.DEVICES.issue(parsed.data.deviceName)
      // The only time the raw token exists outside the client. Never logged.
      return c.json({ deviceToken: token, nodeId: c.env.NODE_ID, device } satisfies PairResult)
    })

  const core = new Hono<AppEnv>()
    .post('/pair/start', (c) => {
      // The plaintext code goes back to the caller because the caller is the node's own UI, which shows
      // it as a QR code and text. Issuing again replaces any live code (pairingCodes.ts).
      //
      // The most important row in the audit table: a pairing window is the one moment this node hands
      // full owner authority to whoever knows a five-minute code. The code itself is not recorded,
      // because an audit trail that quotes a credential is a second copy of it.
      auditRequest(c, { action: 'pairing.window.opened' })
      return c.json({ code: c.env.PAIRING_CODES.issue(), expiresInMs: PAIRING_WINDOW_MS } satisfies PairingWindow)
    })
    .delete('/pair', (c) => {
      // Idempotent: "no window is open" is the state the caller asked for, so closing a closed window
      // answers 204 rather than a 404 the settings UI would have to special-case.
      c.env.PAIRING_CODES.close()
      auditRequest(c, { action: 'pairing.window.closed' })
      return c.body(null, 204)
    })
    .get('/devices', async (c) => c.json({ devices: await c.env.DEVICES.list() } satisfies DevicesResponse))
    .delete('/devices/:id', async (c) => {
      // A device may revoke itself, which is "unpair this machine", and every paired device has full
      // owner authority anyway, so there is no self-revocation guard. 404 only when the device never
      // existed. Revoking an already-revoked one is a 204.
      const existed = await c.env.DEVICES.revoke(c.req.param('id'), auditActor(c))
      return existed ? c.body(null, 204) : respondError(c, 404, 'not_found', ['No such device.'])
    })

  return { open, core }
}
