import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie } from 'hono/cookie'
import { cookieAttrs, openSession, sealSession, SESSION_TTL_SECONDS, type SessionData } from '../session'

export type SessionUser = SessionData
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } }

// Decrypt the session cookie in-CPU (0 KV reads) and attach the user to the context. On
// success, re-issue the cookie with a fresh expiry (sliding TTL). Never throws — routes that
// require a session check for null and return 401. See docs/api-structure.md#auth-middleware.
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const { name, secure } = cookieAttrs(c.req.url)
  const raw = getCookie(c, name)
  const user = raw ? await openSession(raw, c.env.SESSION_ENC_KEY) : null
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
