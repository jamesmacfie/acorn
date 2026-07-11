import { randomUUID } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { PublicApiError } from '../../shared/publicApi/errors'
import { RequestIdSchema } from '../../shared/publicApi/primitives'
import type { PublicAppEnv } from './context'
import type { TokenService } from './tokenService'

// Public request middleware (docs/next/api/authentication.md §5, §8). Order: request id → Host
// guard → bearer. All three run before any endpoint handler.

const WWW_AUTH_INVALID = 'Bearer realm="acorn", error="invalid_token"'

// Assign/echo the request id. Accepts a caller-supplied X-Request-Id matching the grammar; otherwise
// generates one. Echoed in the header and every envelope.
export const requestIdMiddleware = createMiddleware<PublicAppEnv>(async (c, next) => {
  const provided = c.req.header('x-request-id')
  const requestId = provided && RequestIdSchema.safeParse(provided).success ? provided : randomUUID()
  c.set('requestId', requestId)
  c.header('x-request-id', requestId)
  await next()
})

// Exact Host guard (§8). Also enforced at the listener before Hono; kept here as defense in depth
// and for testability. `allowedHost` is 127.0.0.1:<effectivePort>.
export function hostGuard(allowedHost: string) {
  return createMiddleware<PublicAppEnv>(async (c, next) => {
    const host = c.req.header('host')
    if (host !== allowedHost) {
      throw new PublicApiError('forbidden_host', 'Host header is not allowed')
    }
    await next()
  })
}

// Bearer resolver. Requires exactly one RFC 6750 Authorization: Bearer header; rejects cookies,
// x-acorn-internal, duplicate Authorization headers, and any malformed/unknown/expired/revoked
// token with a single 401 invalid_token (never a token-status oracle).
export function bearerAuth(tokens: TokenService) {
  return createMiddleware<PublicAppEnv>(async (c, next) => {
    // Duplicate Authorization headers are ambiguous; reject rather than pick one. Fetch merges
    // repeated headers with ", " — a valid bearer contains no comma, so a comma means >1 header.
    const all = c.req.raw.headers.get('authorization')
    if (!all || !all.startsWith('Bearer ')) throw invalidToken()
    if (all.includes(',')) throw invalidToken()
    const value = all.slice('Bearer '.length).trim()
    const principal = await tokens.authenticate(value)
    if (!principal) throw invalidToken()
    c.set('principal', principal)
    await next()
  })
}

function invalidToken(): PublicApiError {
  return new PublicApiError('invalid_token', 'The bearer token is missing, invalid, expired, or revoked', {
    headers: { 'WWW-Authenticate': WWW_AUTH_INVALID },
  })
}
