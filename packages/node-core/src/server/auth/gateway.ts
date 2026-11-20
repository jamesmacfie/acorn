import type { Context } from 'hono'
import { GATEWAY_TOKEN_LIFETIME_SECONDS, gatewayClaimsSchema } from '@acorn/protocol/account.ts'
import { verifyToken } from '@acorn/protocol/accountToken.ts'
import { relayHost } from '@acorn/protocol/relay.ts'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { GATEWAY_NAMESPACE, type GatewayHandler } from '../routes/gatewayRoutes'
import { readNodeRelay } from '../storage/nodeRelay'

// The checks on a gateway request (../routes/gatewayRoutes.ts), loaded on the first one.

const MAX_BODY_BYTES = 256 * 1024

// Token IDs already accepted, until they expire. In memory: a restart forgets them, so the Node holds a token
// to its 60-second life itself, as `ownerAssertion` does an assertion. One the service signed for longer, or
// dated ahead of this Node's clock past the allowance, is refused, so a replay after a restart has two
// minutes of the Node's time at most.
const seen = new Map<string, number>()
const CLOCK_ALLOWANCE_SECONDS = 60

// A gateway token (docs/account-api/slack-gateway.md § The gateway token), checked with the owner's keys
// the Node recorded when remote access was turned on, as `ownerAssertion` checks an assertion. A key the
// service rotated in after that is unknown here until the Node registers again.
export async function gatewayCaller(
  token: string,
  expected: { nodeId: string; dataDir: string; scope: string },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ accountId: string } | null> {
  const { owner } = readNodeRelay(expected.dataDir)
  if (!owner) return null
  const claims = await verifyToken(token, 'gateway', gatewayClaimsSchema, owner.keys, nowSeconds)
  if (
    !claims ||
    claims.aud !== expected.nodeId ||
    claims.sub !== owner.accountId ||
    claims.scope !== expected.scope ||
    claims.exp - claims.iat > GATEWAY_TOKEN_LIFETIME_SECONDS ||
    claims.iat > nowSeconds + CLOCK_ALLOWANCE_SECONDS
  )
    return null
  for (const [jti, exp] of seen) if (exp <= nowSeconds) seen.delete(jti)
  if (seen.has(claims.jti)) return null
  seen.set(claims.jti, claims.exp)
  return { accountId: claims.sub }
}

export async function serveGatewayRequest(c: Context<AppEnv>, handler: GatewayHandler | undefined): Promise<Response> {
  // A device, task, or service token is a credential, just the wrong kind for this door.
  if (c.get('principal')) return respondError(c, 403, 'forbidden')
  // A Node with no owner has no gateway to hear from.
  if (!handler || !readNodeRelay(c.env.DATA_DIR).owner) return respondError(c, 404, 'not_found')
  const plugin = c.req.param('plugin') ?? ''
  // Through the relay: the relay's name for this Node, a stream with no peer address, and not a phone's
  // channel, which arrives the same way.
  const relayed =
    c.req.header('host') === relayHost(c.env.NODE_ID) && !c.env.incoming?.socket.remoteAddress && !c.env.browserChannel
  const token = c.req.header('authorization')?.match(/^Bearer ([^\s,]+)$/)?.[1]
  const caller =
    relayed && token
      ? await gatewayCaller(token, { nodeId: c.env.NODE_ID, dataDir: c.env.DATA_DIR, scope: plugin })
      : null
  if (!caller) return respondError(c, 401, 'unauthenticated')
  const body = c.req.raw.body ? await readCapped(c.req.raw.body) : new ArrayBuffer(0)
  if (!body) return respondError(c, 413, 'payload_too_large')
  const url = new URL(c.req.url)
  url.pathname = url.pathname.slice(`${GATEWAY_NAMESPACE}/${plugin}`.length) || '/'
  const request = new Request(url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    ...(body.byteLength ? { body } : {}),
  })
  return handler(request, { kind: 'gateway', plugin, accountId: caller.accountId })
}

// The body, or null once it passes the limit. Counted as it's read, not trusted from Content-Length.
async function readCapped(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer | null> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  const joined = Buffer.concat(chunks)
  return joined.buffer.slice(joined.byteOffset, joined.byteOffset + joined.byteLength) as ArrayBuffer
}
