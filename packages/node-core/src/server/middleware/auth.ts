import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie } from 'hono/cookie'
import { openSession, sealSession, SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionData } from '../session'
import type { Env } from '../../main/bindings'

export type SessionUser = SessionData

// The authenticated caller, resolved from whichever credential is present. Routes gate on
// "a principal exists" (via requireUser), never on "a cookie is present" — so a future
// authorized external caller is a new `kind` here + one branch in authMiddleware, not a
// re-touch of every route. See docs/security.md §9.1.
// ponytail: kind + identity is the seam §9.1 needs now; a capability set is added when a
// third principal kind (external caller) actually lands, not before.
export type PrincipalKind = 'user' | 'internal' | 'device'
// `deviceId` is set only for kind 'device'. It is optional, and `user` still carries the V1 shape, so
// that every existing route and the ~28 tests holding inline Principal literals keep compiling while
// the credential swap lands incrementally. The narrowing (drop `user`, require an owner id) happens
// in the commit that deletes the session cookie, where tsc enumerates the work.
export type Principal = { kind: PrincipalKind; user: SessionUser; deviceId?: string }
// `requestId` is set by requestIdMiddleware (server/respond.ts) before anything else, and read by
// every error envelope. It is not optional in practice; a bare test Context is the only way to see
// it missing, which respondError reports as 'unknown'.
export type AppEnv = { Bindings: Env; Variables: { principal: Principal | null; requestId: string } }

// Internal loopback auth (docs/mcp.md): the acorn MCP server holds no session cookie; it sends
// the per-app-run INTERNAL_TOKEN instead. The identity is the machine's single user (this is a
// machine-local single-user app — same reasoning as the machine-scoped tables), resolved from the
// explicit active-identity binding. Never guess from a first prefs/repo row: after sequential
// logins that is nondeterministic and can select another identity's mirror. The GitHub token stays
// empty, so internal callers can only read local mirrors — never call GitHub.
async function internalUser(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<SessionUser | null> {
  const token = c.req.header('x-acorn-internal')
  if (!token || !c.env.INTERNAL_TOKEN || !secretEquals(token, c.env.INTERNAL_TOKEN)) return null
  const login = c.env.ACTIVE_IDENTITY.get()
  if (!login) return null
  return { token: '', login, name: '', avatar: '', scopes: [] }
}

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

// Device bearer (docs/vNext/protocol.md § Transport and identity): the client's connection broker in
// Electron main authenticates with a paired device token. Full owner authority, by design.
//
// A comma in the merged Authorization value means the request carried more than one such header
// (fetch joins repeats with ", "), and a valid bearer contains no comma. That is ambiguous, so it is
// rejected rather than resolved by picking one.
async function deviceUser(
  c: { env: Env; req: { raw: { headers: Headers } } },
): Promise<{ deviceId: string; user: SessionUser } | null> {
  const all = c.env.DEVICES ? c.req.raw.headers.get('authorization') : null
  if (!all || !all.startsWith('Bearer ') || all.includes(',')) return null
  const authenticated = await c.env.DEVICES.authenticate(all.slice('Bearer '.length).trim())
  if (!authenticated) return null
  // The device is the owner, so it inherits the machine's bound identity exactly as the internal
  // principal does. `token: ''` because the GitHub credential is not the session any more — it moves
  // to a stored integration, read by the github plugin rather than off the principal.
  const login = c.env.ACTIVE_IDENTITY.get() ?? ''
  return { deviceId: authenticated.deviceId, user: { token: '', login, name: '', avatar: '', scopes: [] } }
}

// Decrypt the session cookie in-CPU (no session store) and attach the user to the context. When
// the identity came from the cookie, re-issue it with a fresh expiry (sliding TTL); internal-token
// callers hold no cookie, so none is issued. Never throws — routes that require a session check
// for null and return 401. See docs/authentication.md.
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // Bearer first: it is the vNext credential, and resolving it ahead of the cookie means the cookie
  // path is dead code the moment the client stops sending one — which is how it gets deleted safely.
  const device = await deviceUser(c)
  const raw = device ? undefined : getCookie(c, SESSION_COOKIE)
  const cookieUser = raw ? await openSession(raw, c.env.SESSION_ENC_KEY) : null
  const user = cookieUser ?? (await internalUser(c))
  const principal: Principal | null = device
    ? { kind: 'device', user: device.user, deviceId: device.deviceId }
    : cookieUser
      ? { kind: 'user', user: cookieUser }
      : user
        ? { kind: 'internal', user }
        : null
  c.set('principal', principal)

  if (cookieUser) {
    // Idempotent for the common path (the store only writes when the login changes). This also
    // backfills the binding for an existing sealed session after upgrading from older releases.
    c.env.ACTIVE_IDENTITY.set(cookieUser.login)
    const resealed = await sealSession(cookieUser, c.env.SESSION_ENC_KEY)
    setCookie(c, SESSION_COOKIE, resealed, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }

  await next()
})
