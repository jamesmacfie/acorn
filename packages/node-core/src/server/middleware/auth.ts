import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { Env } from '../../main/bindings'

// The authenticated caller. Exactly two kinds, and the shape is now the whole of what a route may know
// about who is asking: an owner id, and (for a device) which device it was.
//
//   device   — a paired client's bearer token (docs/vNext/protocol.md § Transport and identity). Full
//              owner authority, by design: every paired device is the owner.
//   internal — a child process this node spawned (the MCP server, command-variable executions). Route-
//              restricted, and structurally unable to reach GitHub because it holds no credential.
//
// There used to be a third kind, `user`, carrying a whole `SessionUser` decrypted out of a session
// cookie — including the GitHub token. Both are gone. The cookie is gone because the renderer no longer
// shares an origin with any node (it loads from app://acorn and talks through the broker), and the token
// is gone because a device is an IDENTITY, not a provider credential: GitHub now lives in an encrypted
// `integrations` row read through the github plugin's own accessor.
export type PrincipalKind = 'device' | 'internal'
// `userId` is the owner's login — the scope key for every user-scoped table. `deviceId` is set only for
// kind 'device'; the internal principal has no device row to revoke.
export type Principal = { kind: PrincipalKind; userId: string; deviceId?: string }
// `requestId` is set by requestIdMiddleware (server/respond.ts) before anything else, and read by
// every error envelope. It is not optional in practice; a bare test Context is the only way to see
// it missing, which respondError reports as 'unknown'.
export type AppEnv = { Bindings: Env; Variables: { principal: Principal | null; requestId: string } }

// Constant-time compare for bearer material. `===` on a secret leaks its length and a prefix-match
// position through timing; over loopback that is a stretch, but a Node reachable over a LAN
// (docs/vNext/architecture.md § Topology) makes it a real measurement.
function secretEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on unequal lengths rather than returning false, and the length of a
  // presented token is not a secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

// Internal loopback auth (docs/mcp.md): a child process holds no device token; it sends the persisted
// INTERNAL_TOKEN instead. The identity is the machine's single owner, resolved from the explicit
// active-identity binding. Never guess from a first prefs/repo row: after sequential logins that is
// nondeterministic and can select another identity's mirror — so with nothing bound this fails closed.
function internalPrincipal(c: { env: Env; req: { header(name: string): string | undefined } }): Principal | null {
  const token = c.req.header('x-acorn-internal')
  if (!token || !c.env.INTERNAL_TOKEN || !secretEquals(token, c.env.INTERNAL_TOKEN)) return null
  const userId = c.env.ACTIVE_IDENTITY.get()
  return userId ? { kind: 'internal', userId } : null
}

// Device bearer: the client's connection broker in Electron main authenticates with a paired device
// token.
//
// A comma in the merged Authorization value means the request carried more than one such header
// (fetch joins repeats with ", "), and a valid bearer contains no comma. That is ambiguous, so it is
// rejected rather than resolved by picking one.
async function devicePrincipal(c: { env: Env }, header: string): Promise<Principal | null> {
  if (!c.env.DEVICES || header.includes(',')) return null
  const authenticated = await c.env.DEVICES.authenticate(header.slice('Bearer '.length).trim())
  if (!authenticated) return null
  // The device is the owner, so it inherits the machine's bound identity exactly as the internal
  // principal does — but it does NOT fail closed on an empty one: connecting GitHub is what BINDS the
  // identity (the github plugin's device-flow route), and the owner has to be authenticated to do it.
  return { kind: 'device', userId: c.env.ACTIVE_IDENTITY.get() ?? '', deviceId: authenticated.deviceId }
}

// Resolve the caller and attach it to the context. Never throws and never enforces: requireUser is the
// single gate that turns "no principal" into a 401 (server/index.ts mounts them in that order).
//
// There is nothing to re-issue and no cookie to set any more, which is the point — a bearer is presented
// per request and the node holds no session state at all.
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // A presented bearer that fails does NOT fall through to the internal token: presenting a credential
  // and having it rejected is a rejection, not an invitation to try the next mechanism. (The WS hub has
  // always applied this rule at upgrade; the HTTP path only inherited it once there were two mechanisms
  // left instead of three.)
  const bearer = c.req.raw.headers.get('authorization')
  c.set('principal', bearer?.startsWith('Bearer ') ? await devicePrincipal(c, bearer) : internalPrincipal(c))
  await next()
})
