import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie } from 'hono/cookie'
import { getDb, schema } from '../db'
import { openSession, sealSession, SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionData } from '../session'

export type SessionUser = SessionData

// The authenticated caller, resolved from whichever credential is present. Routes gate on
// "a principal exists" (via requireUser), never on "a cookie is present" — so a future
// authorized external caller is a new `kind` here + one branch in authMiddleware, not a
// re-touch of every route. See docs/security.md §9.1.
// ponytail: kind + identity is the seam §9.1 needs now; a capability set is added when a
// third principal kind (external caller) actually lands, not before.
export type PrincipalKind = 'user' | 'internal'
export type Principal = { kind: PrincipalKind; user: SessionUser }
export type AppEnv = { Bindings: Env; Variables: { principal: Principal | null } }

// Internal loopback auth (docs/mcp.md): the acorn MCP server holds no session cookie; it sends
// the per-app-run INTERNAL_TOKEN instead. The identity is the machine's single user (this is a
// machine-local single-user app — same reasoning as the machine-scoped tables), resolved from the
// mirror's user rows; the GitHub token stays empty, so internal callers can only read local
// mirrors — never call GitHub.
async function internalUser(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<SessionUser | null> {
  const token = c.req.header('x-acorn-internal')
  if (!token || !c.env.INTERNAL_TOKEN || token !== c.env.INTERNAL_TOKEN) return null
  const db = getDb(c.env)
  const [row] = await db.select({ userId: schema.prefs.userId }).from(schema.prefs).limit(1)
  const [repoRow] = row ? [row] : await db.select({ userId: schema.repos.userId }).from(schema.repos).limit(1)
  const login = row?.userId ?? repoRow?.userId ?? 'local'
  return { token: '', login, name: '', avatar: '', scopes: [] }
}

// Decrypt the session cookie in-CPU (no session store) and attach the user to the context. When
// the identity came from the cookie, re-issue it with a fresh expiry (sliding TTL); internal-token
// callers hold no cookie, so none is issued. Never throws — routes that require a session check
// for null and return 401. See docs/authentication.md.
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const raw = getCookie(c, SESSION_COOKIE)
  const cookieUser = raw ? await openSession(raw, c.env.SESSION_ENC_KEY) : null
  const user = cookieUser ?? (await internalUser(c))
  const principal: Principal | null = cookieUser
    ? { kind: 'user', user: cookieUser }
    : user
      ? { kind: 'internal', user }
      : null
  c.set('principal', principal)

  if (cookieUser) {
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
