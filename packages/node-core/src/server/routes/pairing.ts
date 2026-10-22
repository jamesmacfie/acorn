import { Hono, type Context } from 'hono'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import {
  ACORN_BUILD,
  NODE_PROTOCOL_VERSION,
  pairingAskSchema,
  pairingClaimSchema,
  pairingDecisionSchema,
  pairRequestSchema,
  type DevicesResponse,
  type NodeInfo,
  type PairingAsk,
  type PairingClaimPending,
  type PairingRequestResponse,
  type PairingWindow,
  type PairResult,
} from '@acorn/protocol/node.ts'
import { auditActor, auditRequest } from '../auditRequest'
import { PAIRING_WINDOW_MS } from '../auth/pairingCodes'
import { pairingRequests } from '../auth/pairingRequests'
import type { AppEnv } from '../middleware/auth'
import { broadcastPairingRequested } from '../notify'
import { respondError } from '../respond'
import { isLoopbackPeer } from '../transport/loopbackPeer'
import { readPairingBody } from './pairingBody'

// Pairing and device management (docs/api-reference/transport.md § Pairing,
// docs/security/transport-and-auth.md § Transport and auth).
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
// Asks count apart from codes, so a loop of asks can't block someone typing a code from another
// computer.
const PAIR_ASKS_PER_WINDOW = 6

function attemptCeiling(perWindow: number, now: () => number = () => Date.now()): () => boolean {
  let windowStartedAt = 0
  let attempts = 0
  return () => {
    const at = now()
    if (at - windowStartedAt >= PAIR_ATTEMPT_WINDOW_MS) {
      windowStartedAt = at
      attempts = 0
    }
    attempts += 1
    return attempts <= perWindow
  }
}

// The single pairing failure (docs/api-reference/transport.md § Pairing): same status, same code, same message,
// no details. 401 because the request presented a credential and it was rejected.
const pairingFailed = (c: Context<AppEnv>): Response => respondError(c, 401, 'pairing_failed', ['Pairing failed.'])

// A device token for the caller, the one time it exists outside the client. Never logged.
async function paired(c: Context<AppEnv>, deviceName: string): Promise<Response> {
  // A device paired through a phone's channel is a phone's, whatever it says about itself.
  const { token, device } = await c.env.DEVICES.issue(deviceName, c.env.browserChannel ? 'phone' : undefined)
  return c.json({
    baseline: ACORN_BASELINE,
    deviceToken: token,
    nodeId: c.env.NODE_ID,
    device,
  } satisfies PairResult)
}

export function pairingRoutes(): { open: Hono<AppEnv>; core: Hono<AppEnv> } {
  const withinCeiling = attemptCeiling(PAIR_ATTEMPTS_PER_WINDOW)
  const withinAskCeiling = attemptCeiling(PAIR_ASKS_PER_WINDOW)
  // Per instance, like the ceiling: a request belongs to the Node that was asked.
  const requests = pairingRequests()

  const open = new Hono<AppEnv>()
    .get('/node', (c) => {
      // authMiddleware has already run and resolved the principal without enforcing it, so this can
      // widen the payload for an authenticated caller without a second credential check.
      const authenticated = c.get('principal') !== null
      const info: NodeInfo = {
        baseline: ACORN_BASELINE,
        protocolVersion: NODE_PROTOCOL_VERSION,
        eventTransport: { viewers: 1 },
        // The certificate a client pins against (docs/api-reference/transport.md § Pairing). Reading it over the
        // connection being authenticated proves nothing. It is the value the owner compares against
        // the code shown on the node.
        fingerprint: c.env.NODE_FINGERPRINT,
        // This is the one response that must stay readable by every client forever, so the bar for a
        // field on it is a real consumer, not a plausible use. Adding one back is one line and always
        // safe, because the schema is additive forever (`nodeInfoSchema`).
        ...(authenticated ? { nodeId: c.env.NODE_ID, buildVersion: ACORN_BUILD } : {}),
        ...(authenticated && c.env.SERVICE_INSTANCE_ID ? { serviceInstanceId: c.env.SERVICE_INSTANCE_ID } : {}),
      }
      return c.json(info)
    })
    .post('/pair', async (c) => {
      if (!withinCeiling())
        return respondError(c, 429, 'rate_limited', ['Too many pairing attempts. Try again shortly.'])
      const body = await readPairingBody(c.req.raw)
      if (body.oversized) return respondError(c, 413, 'payload_too_large', ['Pairing request exceeds 4 KiB.'])
      const parsed = pairRequestSchema.safeParse(body.value)
      // Short-circuit order is load-bearing: a malformed body never reaches consume(), so it cannot
      // spend one of the window's five attempts, and it still answers with the same error.
      if (!parsed.success || !c.env.PAIRING_CODES.consume(parsed.data.code)) return pairingFailed(c)
      return paired(c, parsed.data.deviceName)
    })
    // Pairing by approval (docs/api-reference/transport.md § Pairing by approval). From this computer, or
    // from another one by the Node's owner account: a dialog anyone on the network could raise is a
    // dialog the owner learns to click through. Anyone else pairs with a code. The ceiling bounds the
    // noise a loop of asks makes in the owner's dialog. It doesn't stop a swap: an ask that overlaps
    // another cancels both.
    .post('/pair/requests', async (c) => {
      const remote = !isLoopbackPeer(c.env.incoming?.socket.remoteAddress)
      // A remote ask is counted after its assertion checks out, so a flood of bad ones can't use up the
      // asks the owner has.
      if (!remote && !withinAskCeiling())
        return respondError(c, 429, 'rate_limited', ['Too many pairing attempts. Try again shortly.'])
      const body = await readPairingBody(c.req.raw)
      if (body.oversized) return respondError(c, 413, 'payload_too_large', ['Pairing request exceeds 4 KiB.'])
      const parsed = pairingAskSchema.safeParse(body.value)
      const owner = remote
        ? await (await import('../auth/pairingAssertion')).ownerAssertion(parsed.data?.assertion, c.env)
        : null
      if (remote && !owner)
        return respondError(c, 403, 'pairing_local_only', ['Pair from another computer with a pairing code.'])
      if (!parsed.success) return respondError(c, 400, 'bad_request', ['A pairing request needs a device name.'])
      if (remote && !withinAskCeiling())
        return respondError(c, 429, 'rate_limited', ['Too many pairing attempts. Try again shortly.'])
      const ask = requests.ask(parsed.data.deviceName, remote)
      if (owner)
        auditRequest(c, {
          action: 'pairing.request.raised',
          details: { accountId: owner.accountId, assertionId: owner.assertionId, deviceName: parsed.data.deviceName },
        })
      broadcastPairingRequested()
      if (!ask) return respondError(c, 409, 'pairing_busy', ['Another client asked at the same moment. Try again.'])
      return c.json(ask satisfies PairingAsk)
    })
    // The asker polls this until the owner answers. No ceiling: the secret is 256 random bits, and
    // a ceiling here would count one person's polling against everyone's codes.
    .post('/pair/requests/claim', async (c) => {
      const body = await readPairingBody(c.req.raw)
      if (body.oversized) return respondError(c, 413, 'payload_too_large', ['Pairing request exceeds 4 KiB.'])
      const parsed = pairingClaimSchema.safeParse(body.value)
      const claim = parsed.success ? requests.claim(parsed.data.secret) : { status: 'refused' as const }
      if (claim.status === 'refused') return pairingFailed(c)
      if (claim.status === 'pending') return c.json({ status: 'pending' } satisfies PairingClaimPending, 202)
      return paired(c, claim.deviceName)
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
    // What the owner's dialog shows, read from here rather than from the frame that announced it.
    .get('/pair/requests', (c) => c.json({ request: requests.pending() } satisfies PairingRequestResponse))
    .post('/pair/requests/:id', async (c) => {
      const parsed = pairingDecisionSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', ['Answer allow or deny.'])
      const request = requests.pending()
      if (!request || !requests.decide(c.req.param('id'), parsed.data.decision))
        return respondError(c, 404, 'not_found', ['That pairing request was answered, replaced, or expired.'])
      auditRequest(c, {
        action: 'pairing.request.decided',
        details: { decision: parsed.data.decision, deviceName: request.deviceName },
      })
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
