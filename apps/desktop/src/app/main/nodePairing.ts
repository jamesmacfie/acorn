import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { NODE_PROTOCOL_VERSION, type NodeInfo, type PairResult } from '@acorn/protocol/node.ts'
import type { NodeProbeResult } from '@acorn/protocol/broker.ts'
import { normalizeFingerprint, pinnedTlsOptions } from './nodeBroker'
import { nodeRequest } from './nodeRequest'

// The two requests that turn a URL into a fleet member (docs/vNext/protocol.md § Pairing).
//
// They cannot go through the broker: the broker's whole job is to attach a device token to a pinned
// connection, and pairing exists precisely because there is no token and no pin yet. So this is the one
// place in the app that talks to a node outside the broker, and it is deliberately two functions long.
//
// Electron-free, like nodeBroker.ts, so it can be exercised against a real TLS server.

const PROBE_TIMEOUT_MS = 8_000

// Step 1–2: reach the node and learn the certificate it presents.
//
// This connection is UNVERIFIED by construction — we do not yet know what to trust, and there is no CA
// in this architecture. What makes pairing safe is not this request; it is the owner comparing the
// returned fingerprint against the one the node itself displays, out of band (nodePairRequestSchema).
// Everything here does is get an honest value in front of them:
//
//   - the fingerprint reported is the one the SOCKET presented, not the one the body claims;
//   - the body's self-reported fingerprint must agree with it, which is what catches a middlebox
//     re-terminating TLS and forwarding the real node's response;
//   - a protocol major we cannot speak is reported as incompatible instead of paired and then broken.
//
// No token is sent and nothing is remembered, so an unverified request here grants nothing.
export async function probeNode(endpoint: string): Promise<NodeProbeResult & { certPem: string }> {
  const url = new URL('/v2/node', endpoint)
  if (url.protocol !== 'https:') throw new Error('A node endpoint must be https — the pin is the identity.')

  const { body, certPem, fingerprint } = await unverifiedGet(url)
  const info = JSON.parse(body) as Partial<NodeInfo>
  if (typeof info.protocolVersion !== 'number' || typeof info.fingerprint !== 'string') {
    throw new Error(`${endpoint} did not answer like an acorn node.`)
  }
  if (normalizeFingerprint(info.fingerprint) !== fingerprint) {
    // The node reports its own fingerprint; a peer that re-terminates TLS cannot make the two agree
    // without also owning the node's private key.
    throw new Error('The certificate presented does not match the fingerprint the node reports. Something is intercepting this connection.')
  }
  return {
    endpoint: url.origin,
    fingerprint,
    protocolVersion: info.protocolVersion,
    compatible: info.protocolVersion === NODE_PROTOCOL_VERSION,
    certPem,
  }
}

// Step 3: spend the owner's pairing code, this time over a PINNED connection — the fingerprint they
// just confirmed is now the identity, so the code cannot be handed to an impostor.
export async function pairWithNode(
  probe: { endpoint: string; fingerprint: string; certPem: string },
  request: { code: string; deviceName: string },
): Promise<PairResult> {
  const agent = new HttpsAgent(pinnedTlsOptions(probe.fingerprint, probe.certPem))
  try {
    const response = await nodeRequest({
      url: new URL('/v2/pair', probe.endpoint),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(request)) },
      agent,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const text = new TextDecoder().decode(response.body)
    if (response.status !== 200) {
      // The node answers every pairing failure identically on purpose (pairing.ts), so there is nothing
      // to distinguish here either.
      throw new Error(response.status === 429 ? 'Too many pairing attempts. Try again shortly.' : 'Pairing failed. Check the code and try again.')
    }
    const result = JSON.parse(text) as Partial<PairResult>
    if (!result.deviceToken || !result.nodeId || !result.device) throw new Error('The node returned an unusable pairing result.')
    return result as PairResult
  } finally {
    agent.destroy()
  }
}

// A single GET with the certificate captured off the socket. Written out rather than routed through
// nodeRequest because it needs the peer certificate, which only the raw request exposes — and because
// `rejectUnauthorized: false` must appear exactly once in this codebase, here, next to the reason.
function unverifiedGet(url: URL): Promise<{ body: string; certPem: string; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS }, (res) => {
      const socket = res.socket as import('node:tls').TLSSocket
      const cert = socket.getPeerCertificate()
      if (!cert?.raw) return reject(new Error('The node presented no certificate.'))
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${url.origin} answered ${res.statusCode} at /v2/node.`))
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          certPem: toPem(cert.raw),
          fingerprint: normalizeFingerprint(cert.fingerprint256),
        })
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error(`${url.origin} did not respond.`)))
    req.on('error', reject)
    req.end()
  })
}

const toPem = (der: Buffer): string =>
  `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END CERTIFICATE-----\n`
