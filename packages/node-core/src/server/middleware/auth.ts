import { createMiddleware } from 'hono/factory'
import type { Env } from '../../main/bindings'
import { verifyInternalToken, type InternalScope } from '../auth/internalTokens'

// The authenticated caller. A device is a paired owner client. An internal principal is a Node-owned
// service or child process carrying a scoped HMAC token. Provider credentials are separate encrypted
// integration records and are not part of Principal.
export type PrincipalKind = 'device' | 'internal'
// `userId` is the node owner's opaque id, the scope key for every user-scoped table. `deviceId` is set
// only for kind 'device'; the internal principal has no device row to revoke.
export type Principal = {
  kind: PrincipalKind
  userId: string
  deviceId?: string
  // Set only for kind 'internal'. A route that must not be reachable from an agent-spawned child checks
  // this rather than the kind: `kind === 'internal'` cannot distinguish the service from an agent.
  scope?: InternalScope
  // The task an 'internal' credential is bound to. Route handlers compare it against the task in the
  // URL; before this existed, a token minted for task A could drive task B's tools.
  taskId?: string
  sessionId?: string
}
// `requestId` is set by requestIdMiddleware (server/respond.ts) before anything else, and read by
// every error envelope. It is not optional in practice; a bare test Context is the only way to see
// it missing, which respondError reports as 'unknown'.
export type AppEnv = { Bindings: Env; Variables: { principal: Principal | null; requestId: string } }

// Internal loopback auth (docs/mcp.md): a child process holds no device token; it presents a scoped
// internal token instead (server/auth/internalTokens.ts). The identity is the machine's single owner,
// resolved from the explicit active-identity binding, minted at boot (main/core/identity/identity.ts),
// so after first boot it is always present. The fail-closed null stays for the one context that can
// still see an unbound store: a bare test Env built without ensureBoundIdentity.
//
// The token is verified by HMAC against INTERNAL_TOKEN, which is now the signing key rather than the
// credential itself. secretEquals is no longer used here; verifyInternalToken does its own
// constant-time comparison over the signature.
function internalPrincipal(c: { env: Env; req: { header(name: string): string | undefined } }): Principal | null {
  const token = c.req.header('x-acorn-internal')
  if (!token || !c.env.INTERNAL_TOKEN) return null
  const claims = verifyInternalToken(c.env.INTERNAL_TOKEN, token)
  if (!claims) return null
  const userId = c.env.ACTIVE_IDENTITY.get()
  return userId ? { kind: 'internal', userId, scope: claims.scope, taskId: claims.taskId, sessionId: claims.sessionId } : null
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
  // principal does. The '' fallback is vestigial: the identity is minted at boot now, and kept only
  // so a bare test Env without a bound store still authenticates.
  return { kind: 'device', userId: c.env.ACTIVE_IDENTITY.get() ?? '', deviceId: authenticated.deviceId }
}

// Resolve the caller and attach it to the context. Never throws and never enforces: requireUser is the
// single gate that turns "no principal" into a 401 (server/index.ts mounts them in that order).
//
// There is nothing to re-issue and no cookie to set any more: a bearer is presented
// per request and the node holds no session state at all.
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // A presented bearer that fails does not fall through to the internal token: presenting a credential
  // and having it rejected is a rejection, not an invitation to try the next mechanism. (The WS hub has
  // always applied this rule at upgrade; the HTTP path only inherited it once there were two mechanisms
  // left instead of three.)
  const bearer = c.req.raw.headers.get('authorization')
  c.set('principal', bearer?.startsWith('Bearer ') ? await devicePrincipal(c, bearer) : internalPrincipal(c))
  await next()
})
