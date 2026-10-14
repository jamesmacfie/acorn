import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import {
  NODE_PROTOCOL_VERSION,
  nodeInfoSchema,
  pairResultSchema,
  type PairingAsk,
  type PairResult,
} from '@acorn/protocol/node.ts'
import type { NodeProbeResult } from '@acorn/protocol/broker.ts'
import { normalizeFingerprint, pinnedTlsOptions } from './nodeBroker'
import { nodeRequest, readBoundedResponse } from './nodeRequest'

// The requests that turn a URL into a fleet member. See docs/api-reference.md, "Pairing".
//
// They cannot go through the broker. The broker's job is to attach a device token to a pinned
// connection, and pairing exists because there is no token and no pin yet. So this is the one place
// in the app that talks to a node outside the broker, and it stays this small on purpose: a probe,
// then a code, or an ask and its collection.
//
// Shell-free, like nodeBroker.ts, so it can be exercised against a real TLS server.

const PROBE_TIMEOUT_MS = 8_000
export const MAX_NODE_PROBE_BYTES = 16 * 1024
const MAX_PAIR_RESPONSE_BYTES = 64 * 1024

// Steps 1 and 2: reach the node and learn the certificate it presents.
//
// This connection is unverified by construction. There is no CA in this architecture and nothing yet
// knows what to trust. What makes pairing safe is the owner comparing the returned fingerprint
// against the one the node displays, out of band. All this does is get an honest value in front of
// them:
//
//   - The fingerprint reported is the one the socket presented, not the one the body claims.
//   - The body's self-reported fingerprint has to agree with it, which catches a middlebox
//     re-terminating TLS and forwarding the real node's response.
//   - A protocol major this client cannot speak is reported as incompatible rather than paired and
//     then broken.
//
// No token is sent and nothing is remembered, so an unverified request here grants nothing.
export async function probeNode(
  endpoint: string,
  options: { timeoutMs?: number } = {},
): Promise<NodeProbeResult & { certPem: string }> {
  const url = new URL('/v1/node', endpoint)
  if (url.protocol !== 'https:') throw new Error('A node endpoint must be https — the pin is the identity.')

  const { body, certPem, fingerprint } = await unverifiedGet(
    url,
    Math.min(options.timeoutMs ?? PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS),
  )
  const payload: unknown = JSON.parse(body)
  const parsedInfo = nodeInfoSchema.safeParse(payload)
  if (!parsedInfo.success) {
    // Two very different failures land here. `nodeInfoSchema` is additive-forever, so a
    // newer node still parses, but a future major that reshaped this response would not, and telling
    // its owner "this is not an acorn node" sends them to check the URL instead of the version.
    //
    // So a body that announces a protocol at all is an acorn node, and the answer is the version.
    // Read straight off the payload rather than through a second schema, because this is the case
    // where the schema does not fit what came back.
    const claimed = (payload as { protocolVersion?: unknown } | null)?.protocolVersion
    if (typeof claimed === 'number') {
      const baseline = (payload as { baseline?: unknown } | null)?.baseline
      if (baseline !== ACORN_BASELINE)
        throw new Error(
          `${endpoint} has no matching ${ACORN_BASELINE} baseline. Reset or rebuild the node before pairing.`,
        )
      throw new Error(
        `${endpoint} speaks acorn protocol ${claimed}; this app speaks ${NODE_PROTOCOL_VERSION}. Upgrade whichever is older.`,
      )
    }
    throw new Error(`${endpoint} did not answer like an acorn node.`)
  }
  const info = parsedInfo.data
  if (normalizeFingerprint(info.fingerprint) !== fingerprint) {
    // The node reports its own fingerprint. A peer that re-terminates TLS cannot make the two agree
    // without also owning the node's private key.
    throw new Error(
      'The certificate presented does not match the fingerprint the node reports. Something is intercepting this connection.',
    )
  }
  return {
    endpoint: url.origin,
    fingerprint,
    protocolVersion: info.protocolVersion,
    baseline: info.baseline,
    compatible: info.protocolVersion === NODE_PROTOCOL_VERSION,
    certPem,
  }
}

type PinnedProbe = {
  endpoint: string
  fingerprint: string
  certPem: string
  baseline?: string | null
  compatible?: boolean
}

// Step 3: spend the owner's pairing code, this time over a pinned connection. The fingerprint they
// just confirmed is now the identity, so the code cannot be handed to an impostor.
export async function pairWithNode(
  probe: PinnedProbe,
  request: { code: string; deviceName: string },
): Promise<PairResult> {
  const { status, body } = await pinnedPost(probe, '/v1/pair', request)
  if (status !== 200) {
    // The node answers every pairing failure identically on purpose. See pairing.ts.
    throw new Error(
      status === 429
        ? 'Too many pairing attempts. Try again shortly.'
        : 'Pairing failed. Check the code and try again.',
    )
  }
  return pairResult(body)
}

// Pairing by approval (docs/api-reference/transport.md § Pairing by approval), for the Node on this
// computer: ask, and show the phrase so the owner can match it in their dialog. Null when the Node
// can't take an ask, such as one that isn't on this computer or one that is answering too many,
// which leaves the code as the way in.
export async function askToPair(probe: PinnedProbe, deviceName: string): Promise<PairingAsk | null> {
  const { status, body } = await pinnedPost(probe, '/v1/pair/requests', { deviceName })
  if (status !== 200) return null
  const ask = JSON.parse(body) as Partial<PairingAsk>
  return typeof ask.secret === 'string' && typeof ask.phrase === 'string' ? (ask as PairingAsk) : null
}

// The token, once the owner allows the ask. Null while they haven't answered. Throws when the Node
// refuses: denied, expired, or replaced by a newer ask.
export async function collectPairing(probe: PinnedProbe, secret: string): Promise<PairResult | null> {
  const { status, body } = await pinnedPost(probe, '/v1/pair/requests/claim', { secret })
  if (status === 202) return null
  if (status !== 200) throw new Error('The pairing request was denied or has expired.')
  return pairResult(body)
}

function pairResult(body: string): PairResult {
  const result = pairResultSchema.safeParse(JSON.parse(body))
  if (!result.success) throw new Error('The node returned an unusable pairing result.')
  return result.data
}

// Over a pinned connection: the fingerprint the owner just confirmed, or read from the Node's own
// files, is the identity from here on, so nothing sent can reach an impostor.
async function pinnedPost(
  probe: PinnedProbe,
  path: string,
  request: unknown,
): Promise<{ status: number; body: string }> {
  if (probe.baseline !== ACORN_BASELINE || probe.compatible === false)
    throw new Error(`Node baseline or protocol does not match ${ACORN_BASELINE}; pairing was refused.`)
  const agent = new HttpsAgent(pinnedTlsOptions(probe.fingerprint, probe.certPem))
  try {
    const response = await nodeRequest({
      url: new URL(path, probe.endpoint),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(request)) },
      agent,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      maxResponseBytes: MAX_PAIR_RESPONSE_BYTES,
    })
    return { status: response.status, body: new TextDecoder().decode(response.body) }
  } finally {
    agent.destroy()
  }
}

// A single GET with the certificate captured off the socket. Written out rather than routed through
// nodeRequest because it needs the peer certificate, which only the raw request exposes, and because
// `rejectUnauthorized: false` appears once in this codebase, here, next to the reason.
function unverifiedGet(url: URL, timeoutMs: number): Promise<{ body: string; certPem: string; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error: unknown, result?: { body: string; certPem: string; fingerprint: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (result) resolve(result)
      else reject(error)
    }
    // `agent: false` gives every probe a fresh TLS handshake. Through the shared agent, a second probe
    // of the same address resumes the cached session, and a resumed session exposes no certificate.
    const req = httpsRequest(url, { method: 'GET', rejectUnauthorized: false, agent: false }, (res) => {
      if (settled) {
        res.destroy()
        return
      }
      const socket = res.socket as import('node:tls').TLSSocket
      const cert = socket.getPeerCertificate()
      if (!cert?.raw) {
        res.destroy()
        return finish(new Error('The node presented no certificate.'))
      }
      void readBoundedResponse(res, MAX_NODE_PROBE_BYTES).then(
        (body) => {
          if (res.statusCode !== 200) return finish(new Error(`${url.origin} answered ${res.statusCode} at /v1/node.`))
          finish(null, {
            body: body.toString('utf8'),
            certPem: toPem(cert.raw),
            fingerprint: normalizeFingerprint(cert.fingerprint256),
          })
        },
        (error: unknown) => finish(error),
      )
    })
    // One deadline across connect, TLS, headers and body. Activity cannot extend it.
    const deadline = setTimeout(() => {
      const error = new Error(`${url.origin} did not respond within the probe deadline.`)
      finish(error)
      req.destroy(error)
    }, timeoutMs)
    deadline.unref()
    req.on('error', (error) => finish(error))
    req.end()
  })
}

const toPem = (der: Buffer): string =>
  `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trimEnd()}\n-----END CERTIFICATE-----\n`
