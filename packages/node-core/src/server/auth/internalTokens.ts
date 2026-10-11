// Internal tokens: scope, signing, and expiry (docs/security/credentials.md § Credential handling).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { normalizeToolCeiling, toolCeilingSchema, type ToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import type { ActiveCredentials } from './activeCredentials'

// 'service': the node calling its own HTTP surface over loopback (notes seeding, workflow context
//   assembly). Full reach, minted in-process, and never placed in a child's environment.
// 'task': everything handed to a child process, PTYs, agent sessions, workflow steps, MCP servers.
//   Task-addressed routes only; cannot read a provider credential, cannot pair, cannot administer
//   devices, cannot mint anything.
export type InternalScope = 'service' | 'task'

export type InternalClaims = {
  scope: InternalScope
  // Present for 'task' scope. The credential's task, which is what route handlers compare against the
  // task in the URL (docs/security/transport-and-auth.md § Transport and auth: the escalation this comparison closes).
  taskId?: string
  // The terminal/agent session, when the child belongs to one. Agent-tool contributions may require
  // this signed owner rather than accepting attribution supplied as transport metadata.
  sessionId?: string
  // The effective ceiling this server computed for the child. Unlike ACORN_TOOL_CEILING, this value is
  // covered by the signature and is therefore safe to enforce on the loopback tool projection.
  toolCeiling?: ToolCeiling
  // A task token's revocable id. Minting picks one and renewal keeps it, so a renewed file stays the
  // same credential. Authentication checks it against ActiveCredentials (./activeCredentials.ts).
  credentialId?: string
}

const PREFIX = 'acorn_it_'
// '.' separates payload from signature, as in a JWT, and for the same reason: base64url's alphabet is
// [A-Za-z0-9_-], so it can contain '_' but never '.'. Splitting on '_' would give a payload or
// signature containing an underscore more than the expected number of parts, and the token would fail
// to verify.
const SEPARATOR = '.'
export const INTERNAL_TOKEN_LIFETIME_MS = 48 * 60 * 60 * 1000
const internalClaimsPayloadSchema = z.strictObject({
  s: z.enum(['service', 'task']),
  t: z.string().min(1).optional(),
  n: z.string().min(1).optional(),
  c: toolCeilingSchema.optional(),
  i: z.string().min(1).optional(),
  e: z.number().int().positive(),
})
const b64 = (value: Buffer | string): string => Buffer.from(value).toString('base64url')

const sign = (key: string, payload: string): string => createHmac('sha256', key).update(payload).digest('base64url')

export function mintInternalToken(key: string, claims: InternalClaims): string {
  if (!key) throw new Error('Cannot mint an internal token without a signing key.')
  if (claims.scope === 'task' && !claims.taskId) throw new Error("A 'task'-scoped internal token requires a taskId.")
  // Short keys keep the token out of the way in `env` output: s=scope, t=taskId, n=sessioN,
  // c=effective tool Ceiling, i=credential Id, e=expiry in milliseconds since the epoch. A service
  // token never leaves the process, so only a task token needs an id to revoke.
  const credentialId =
    claims.scope === 'task' ? (claims.credentialId ?? randomBytes(16).toString('base64url')) : undefined
  const payload = b64(
    JSON.stringify({
      s: claims.scope,
      ...(claims.taskId ? { t: claims.taskId } : {}),
      ...(claims.sessionId ? { n: claims.sessionId } : {}),
      ...(claims.toolCeiling ? { c: normalizeToolCeiling(claims.toolCeiling) } : {}),
      ...(credentialId ? { i: credentialId } : {}),
      e: Date.now() + INTERNAL_TOKEN_LIFETIME_MS,
    }),
  )
  return `${PREFIX}${payload}${SEPARATOR}${sign(key, payload)}`
}

// Returns null for anything wrong: bad shape, bad signature, unknown scope, task scope with no task.
// Uniformly null, so a caller cannot distinguish "malformed" from "forged" (the same rule pairing
// already follows).
//
function signedClaims(key: string, token: string): (InternalClaims & { expiresAt: number }) | null {
  if (!key || !token) return null
  if (!token.startsWith(PREFIX)) return null
  const parts = token.slice(PREFIX.length).split(SEPARATOR)
  if (parts.length !== 2) return null
  const [payload, presented] = parts
  const expected = sign(key, payload)
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const decoded = internalClaimsPayloadSchema.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    )
    if (!decoded.success || (decoded.data.s === 'task' && !decoded.data.t)) return null
    return {
      scope: decoded.data.s,
      taskId: decoded.data.t,
      sessionId: decoded.data.n,
      toolCeiling: decoded.data.c ? normalizeToolCeiling(decoded.data.c) : undefined,
      credentialId: decoded.data.i,
      expiresAt: decoded.data.e,
    }
  } catch {
    return null
  }
}

// All failures share the same null result, including expiry. A renewal file can be refreshed by the
// Node after restart using the signed claims, but an expired token presented to HTTP never authenticates.
export function verifyInternalToken(key: string, token: string): InternalClaims | null {
  const claims = signedClaims(key, token)
  if (!claims || claims.expiresAt <= Date.now()) return null
  const { expiresAt: _expiresAt, ...principalClaims } = claims
  return principalClaims
}

// What HTTP and the WebSocket hub accept: a valid signature, and for a task token an id that is still
// active. A token minted before ids existed has none, so it fails here, and the Node's renewal gives its
// file a new token with an id at the next start.
export function authenticateInternalToken(
  key: string,
  active: Pick<ActiveCredentials, 'isActive'>,
  token: string,
): InternalClaims | null {
  const claims = verifyInternalToken(key, token)
  return claims && (claims.scope === 'service' || active.isActive(claims.credentialId)) ? claims : null
}

// Node-owned credential files are the sole caller. This preserves every signed scope and ceiling;
// it cannot turn an expired task token into a service token or change its task.
export function renewInternalToken(key: string, token: string): string | null {
  const claims = signedClaims(key, token)
  if (!claims) return null
  const { expiresAt: _expiresAt, ...sameClaims } = claims
  return mintInternalToken(key, sameClaims)
}

// The environment a spawned child needs to call this node back, with a token minted for that child's
// scope. A factory rather than one shared record: a shared record would have every PTY, agent session
// and workflow step present the same credential, which makes scope unrepresentable.
//
// ACORN_API_URL is absent from the claims: it is a property of the listener, not the
// caller, so the composition root closes over it and fills it in once the port is known.
export type InternalEnvFactory = {
  (claims: InternalClaims): Record<string, string>
  // A bounded child such as a workflow step releases its renewable file when it exits, which also
  // revokes its token. Session children keep theirs across reattach and never call this method.
  release?(env: Record<string, string>): void
  // A session removed for good revokes its token and deletes its file. Minting a session's token again
  // revokes the one before, so a restarted session needs no call here.
  revokeSession?(session: { taskId: string; sessionId: string }): void
}
