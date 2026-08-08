// Internal tokens are stateless HMAC credentials. Claims distinguish Node service calls from child
// calls and bind task credentials to one task. The signing key persists so tmux-reattached sessions
// can reconnect after a Node restart; rotating the key revokes outstanding tokens. Tokens do not
// expire, so scope and key rotation are the active lifetime controls.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

// 'service' — the node calling its own HTTP surface over loopback (notes seeding, workflow context
//   assembly). Full reach, minted in-process, and NEVER placed in a child's environment.
// 'task'    — everything handed to a child process: PTYs, agent sessions, workflow steps, MCP servers.
//   Task-addressed routes only; cannot read a provider credential, cannot pair, cannot administer
//   devices, cannot mint anything.
export type InternalScope = 'service' | 'task'

export type InternalClaims = {
  scope: InternalScope
  // Present for 'task' scope. The credential's task, which is what route handlers compare against the
  // task in the URL — that comparison is the escalation this closes.
  taskId?: string
  // The terminal/agent session, when the child belongs to one. Carried for attribution and for a future
  // per-session revocation sweep; nothing enforces on it yet.
  sessionId?: string
}

const PREFIX = 'acorn_it_'
// '.' separates payload from signature, as in a JWT, and for the same reason: base64url's alphabet is
// [A-Za-z0-9_-], so it can contain '_' but never '.'. Splitting on '_' looked fine and was wrong — a
// payload or signature containing an underscore produced more than the expected number of parts and
// every such token failed to verify. Caught by auth.test.ts on the first run.
const SEPARATOR = '.'
const internalClaimsPayloadSchema = z.strictObject({
  s: z.enum(['service', 'task']),
  t: z.string().min(1).optional(),
  n: z.string().min(1).optional(),
})
const b64 = (value: Buffer | string): string => Buffer.from(value).toString('base64url')

const sign = (key: string, payload: string): string => createHmac('sha256', key).update(payload).digest('base64url')

export function mintInternalToken(key: string, claims: InternalClaims): string {
  if (!key) throw new Error('Cannot mint an internal token without a signing key.')
  if (claims.scope === 'task' && !claims.taskId) throw new Error("A 'task'-scoped internal token requires a taskId.")
  // Short keys keep the token out of the way in `env` output: s=scope, t=taskId, n=sessioN.
  const payload = b64(JSON.stringify({ s: claims.scope, ...(claims.taskId ? { t: claims.taskId } : {}), ...(claims.sessionId ? { n: claims.sessionId } : {}) }))
  return `${PREFIX}${payload}${SEPARATOR}${sign(key, payload)}`
}

// Returns null for anything wrong — bad shape, bad signature, unknown scope, task scope with no task.
// Uniformly null, so a caller cannot distinguish "malformed" from "forged" (the same rule pairing
// already follows).
//
// Tokens do not expire. Reattached tmux agents retain the environment of the boot that spawned them, so
// scope and signing-key rotation provide the operational boundary and revocation lever.
export function verifyInternalToken(key: string, token: string): InternalClaims | null {
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
    const decoded = internalClaimsPayloadSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
    if (!decoded.success || (decoded.data.s === 'task' && !decoded.data.t)) return null
    return { scope: decoded.data.s, taskId: decoded.data.t, sessionId: decoded.data.n }
  } catch {
    return null
  }
}

// The environment a spawned child needs to call this node back, with a token minted for that child's
// scope. A FACTORY rather than the single shared record it replaces: one object meant every PTY, agent
// session and workflow step presented the same credential, which is what made scope unrepresentable.
//
// ACORN_API_URL is deliberately absent from the claims — it is a property of the listener, not the
// caller — so the composition root closes over it and fills it in once the port is known.
export type InternalEnvFactory = (claims: InternalClaims) => Record<string, string>
