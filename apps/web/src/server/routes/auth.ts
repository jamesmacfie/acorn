import { Hono } from 'hono'

// ponytail: /login builds the real GitHub authorize URL so the redirect can be eyeballed;
// /callback and session sealing are deferred (auth is explicitly out of scope for now).
export const auth = new Hono<{ Bindings: Env }>()
  .get('/login', (c) => {
    const params = new URLSearchParams({
      client_id: c.env.GITHUB_CLIENT_ID ?? '',
      redirect_uri: new URL('/auth/callback', c.req.url).toString(),
      scope: 'repo read:org read:user',
      // ponytail: state must be random + stored in OAUTH_STATE KV (5-min TTL) and verified
      // on callback (docs/auth.md). Deferred with the rest of the OAuth flow.
      state: 'dev',
    })
    return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
  })
  .get('/callback', (c) => c.text('auth callback stub — session sealing not implemented yet', 501))
  .post('/logout', (c) => {
    c.header('Set-Cookie', '__Host-session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax')
    return c.body(null, 204)
  })
