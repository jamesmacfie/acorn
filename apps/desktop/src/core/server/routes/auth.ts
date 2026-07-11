import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sealSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../session'

// GitHub OAuth web flow (docs/authentication.md). The local server exchanges the code for a
// token and seals it into the session cookie; the browser never sees the token. All cookies
// are plain-HTTP (no Secure flag): the server only ever runs on loopback http://127.0.0.1.

const GITHUB_SCOPES = 'repo read:org read:user'
const STATE_COOKIE = 'oauth_state'
const RETURN_TO_COOKIE = 'oauth_return_to'
const STATE_TTL_SECONDS = 300
const GITHUB_OAUTH_SETTINGS_URL = 'https://github.com/settings/applications'

// Only allow relative paths (not protocol-relative or external) to prevent open redirect.
function safeReturnTo(value: string | undefined): string {
  if (!value) return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export function oauthAppSettingsUrl(clientId: string): string {
  const id = clientId.trim()
  return id ? `https://github.com/settings/connections/applications/${encodeURIComponent(id)}` : GITHUB_OAUTH_SETTINGS_URL
}

// Constant-time string compare — avoids leaking the state via comparison timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const auth = new Hono<{ Bindings: Env }>()
  // Playwright-Electron smoke seam. It is unreachable unless the process was explicitly launched
  // in E2E mode; production builds return 404 and keep the normal OAuth flow as the only login.
  .get('/test-login', async (c) => {
    if (process.env.ACORN_E2E !== '1') return c.notFound()
    const sealed = await sealSession(
      { token: 'e2e-token', login: 'e2e', name: 'E2E User', avatar: '', scopes: [] },
      c.env.SESSION_ENC_KEY,
    )
    setCookie(c, SESSION_COOKIE, sealed, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_SECONDS })
    return c.redirect('/')
  })
  .get('/login', async (c) => {
    const state = crypto.randomUUID()
    // CSRF: remember the state for 5 min (one-time use, consumed on callback) AND bind it to
    // this browser via a short-lived cookie, so a state minted in one browser can't be
    // completed in another (login-CSRF). Both must match on callback. The store's TTL is
    // internal (main/bindings.ts) and matches STATE_TTL_SECONDS here.
    c.env.OAUTH_STATE.issue(state)
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/auth',
      maxAge: STATE_TTL_SECONDS,
    })
    // Preserve the deep-link URL so the callback can send the user back there after login.
    const returnTo = safeReturnTo(c.req.query('return_to'))
    setCookie(c, RETURN_TO_COOKIE, returnTo, {
      httpOnly: true,
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
  .get('/permissions', (c) => c.redirect(oauthAppSettingsUrl(c.env.GITHUB_CLIENT_ID)))
  .get('/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    if (!code || !state) return c.text('missing code/state', 400)

    // Browser binding: the state must match the cookie set at /login (same browser)…
    const cookieState = getCookie(c, STATE_COOKIE)
    deleteCookie(c, STATE_COOKIE, { path: '/auth' })
    if (!cookieState || !timingSafeEqual(cookieState, state)) return c.text('invalid state', 403)
    // …and still be a live, one-time server-issued state (consume removes it).
    if (!c.env.OAUTH_STATE.consume(state)) return c.text('invalid state', 403)

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

    // Fetch the profile for the UI header. GitHub is the identity provider, so this login-time
    // /user call is core auth infra — kept inline (like the token exchange above) rather than
    // depending on the github plugin's API client, so auth stays core (docs/plugins.md).
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'acorn' },
    })
    if (!userRes.ok) return c.redirect('/auth/login')
    const user = (await userRes.json()) as { login: string; name: string | null; avatar_url: string }

    const scopes = tokenJson.scope ? tokenJson.scope.split(',').map((s) => s.trim()).filter(Boolean) : []

    // Persist the GitHub credential encrypted at rest so bearer API tokens (which carry no cookie)
    // can call GitHub on this user's behalf (docs/next/api/authentication.md §7). Best-effort — a
    // storage failure must not block the browser login itself.
    try {
      await c.env.OAUTH_ACCOUNTS.upsertGithub({
        login: user.login,
        accessToken: token,
        name: user.name ?? user.login,
        avatar: user.avatar_url,
        scopes,
      })
    } catch (e) {
      console.warn('[auth] oauth_accounts upsert failed:', e)
    }

    const sealed = await sealSession(
      {
        token,
        login: user.login,
        name: user.name ?? user.login,
        avatar: user.avatar_url,
        scopes,
      },
      c.env.SESSION_ENC_KEY,
    )

    setCookie(c, SESSION_COOKIE, sealed, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    const returnTo = safeReturnTo(getCookie(c, RETURN_TO_COOKIE))
    deleteCookie(c, RETURN_TO_COOKIE, { path: '/auth' })
    return c.redirect(returnTo)
  })
  .post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.body(null, 204)
  })
