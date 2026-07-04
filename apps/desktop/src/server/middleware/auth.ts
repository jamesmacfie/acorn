import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie } from 'hono/cookie'
import { getDb, schema } from '../db'
import { cookieAttrs, openSession, sealSession, SESSION_TTL_SECONDS, type SessionData } from '../session'

export type SessionUser = SessionData
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } }

// Internal loopback auth (docs/next 06 B): the acorn MCP server holds no session cookie; it sends
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

// Decrypt the session cookie in-CPU (0 KV reads) and attach the user to the context. On
// success, re-issue the cookie with a fresh expiry (sliding TTL). Never throws — routes that
// require a session check for null and return 401. See docs/api-structure.md#auth-middleware.
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const { name, secure } = cookieAttrs(c.req.url)
  const raw = getCookie(c, name)
  const user = (raw ? await openSession(raw, c.env.SESSION_ENC_KEY) : null) ?? (await internalUser(c))
  c.set('user', user)

  if (user) {
    const resealed = await sealSession(user, c.env.SESSION_ENC_KEY)
    setCookie(c, name, resealed, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }

  await next()
})
