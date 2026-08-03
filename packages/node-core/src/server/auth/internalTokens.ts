// Scoped internal tokens (docs/vNext/protocol.md § Transport: internal tokens are "task- or
// session-scoped, expiring, and restricted: they can call only the routes their scope declares, and can
// never read secrets back, mint tokens, pair, or touch device management").
//
// What this replaces, and why it is the phase's most important fix: there was ONE node-wide
// INTERNAL_TOKEN, a bare UUID, injected identically into every PTY, every agent session, every workflow
// step, and used by the service to call itself over loopback. So a single string meant two completely
// different things — "the service calling itself" and "a child an agent spawned" — and the auth layer
// could not tell them apart. Two consequences followed:
//
//   1. An agent could spend the owner's stored GitHub credential, because githubToken() resolves the
//      row for ownerId(c) and ownerId is the same for both. docs/vNext/phase1-notes.md records this as a
//      known divergence pending exactly this change.
//   2. Task scoping was decorative. routes/agentTools.ts takes the taskId from the URL, so a token
//      handed to task A's agent could call /v2/core/tasks/B/tools/* — the credential said nothing about
//      which task it belonged to.
//
// Design: a stateless HMAC token, NOT a row in a table.
//
// The reason is a real constraint, not taste. An agent pane runs under tmux and is reattached after a
// restart, keeping the environment of the boot that spawned it — which is exactly why the old token was
// deliberately persisted across boots. A token that has to be looked up in a table would either need
// those rows to outlive the boot (a new table, a new sweep, a new failure mode) or would break every
// reattached session. Signing with a key that is already persisted gives the same property with no
// storage: the token verifies as long as the key exists, and the key is the file the old token lived in.
//
// No expiry, and that is a deliberate gap: see the note on `verifyInternalToken`.
import { createHmac, timingSafeEqual } from 'node:crypto'

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
// No expiry check, and the omission is deliberate rather than forgotten. protocol.md asks for expiring
// tokens; a reattached tmux agent holds the environment of the boot that spawned it, so an expiry short
// enough to matter would break the reattach case that made the old token persistent in the first place,
// and an expiry long enough not to would buy nothing. What actually bounds these tokens is scope, which
// is what this change adds. Rotating the signing key invalidates every outstanding token at once, which
// is the revocation lever that does exist.
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
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { s?: unknown; t?: unknown; n?: unknown }
    if (decoded.s !== 'service' && decoded.s !== 'task') return null
    const taskId = typeof decoded.t === 'string' && decoded.t ? decoded.t : undefined
    const sessionId = typeof decoded.n === 'string' && decoded.n ? decoded.n : undefined
    if (decoded.s === 'task' && !taskId) return null
    return { scope: decoded.s, taskId, sessionId }
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
