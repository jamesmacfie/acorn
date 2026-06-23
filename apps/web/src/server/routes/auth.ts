import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cookieAttrs, sealSession, SESSION_TTL_SECONDS } from '../session'

// GitHub OAuth web flow (docs/auth.md). The Worker exchanges the code for a token and seals
// it into the session cookie; the browser never sees the token.

const GITHUB_SCOPES = 'repo read:org read:user'
const STATE_COOKIE = 'oauth_state'
const STATE_TTL_SECONDS = 300

// Constant-time string compare — avoids leaking the state via comparison timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const auth = new Hono<{ Bindings: Env }>()
  .get('/login', async (c) => {
    const state = crypto.randomUUID()
    // CSRF: remember the state for 5 min (one-time use, consumed on callback) AND bind it to
    // this browser via a short-lived cookie, so a state minted in one browser can't be
    // completed in another (login-CSRF). Both must match on callback.
    await c.env.OAUTH_STATE.put(state, '1', { expirationTtl: STATE_TTL_SECONDS })
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: cookieAttrs(c.req.url).secure,
      sameSite: 'Lax',
      path: '/auth',
      maxAge: STATE_TTL_SECONDS,
    })
    const params = new URLSearchParams({
      client_id: c.env.GITHUB_CLIENT_ID,
      redirect_uri: new URL('/auth/callback', c.req.url).toString(),
      scope: GITHUB_SCOPES,
      state,
    })
    return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
  })
  .get('/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    if (!code || !state) return c.text('missing code/state', 400)

    // Browser binding: the state must match the cookie set at /login (same browser)…
    const cookieState = getCookie(c, STATE_COOKIE)
    deleteCookie(c, STATE_COOKIE, { path: '/auth', secure: cookieAttrs(c.req.url).secure })
    if (!cookieState || !timingSafeEqual(cookieState, state)) return c.text('invalid state', 403)
    // …and still be a live, one-time server-issued state (consumed here).
    if (!(await c.env.OAUTH_STATE.get(state))) return c.text('invalid state', 403)
    await c.env.OAUTH_STATE.delete(state)

    // Exchange the code for an access token.
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: new URL('/auth/callback', c.req.url).toString(),
      }),
    })
    const tokenJson = (await tokenRes.json()) as { access_token?: string; scope?: string; error?: string }
    if (!tokenJson.access_token) return c.redirect('/auth/login')
    const token = tokenJson.access_token

    // Fetch the profile for the UI header.
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gurthurd',
      },
    })
    if (!userRes.ok) return c.redirect('/auth/login')
    const user = (await userRes.json()) as { login: string; name: string | null; avatar_url: string }

    const sealed = await sealSession(
      {
        token,
        login: user.login,
        name: user.name ?? user.login,
        avatar: user.avatar_url,
        scopes: tokenJson.scope ? tokenJson.scope.split(',').map((s) => s.trim()).filter(Boolean) : [],
      },
      c.env.SESSION_ENC_KEY,
    )

    const { name, secure } = cookieAttrs(c.req.url)
    setCookie(c, name, sealed, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    return c.redirect('/')
  })
  .post('/logout', (c) => {
    // Clear whichever cookie is in play (prod __Host-session and the dev fallback).
    deleteCookie(c, '__Host-session', { path: '/', secure: true })
    deleteCookie(c, 'session', { path: '/' })
    return c.body(null, 204)
  })
