# Authentication

aacorn authenticates users with GitHub via the OAuth 2.0 web flow. The Worker
exchanges the OAuth code for an access token and seals it into an encrypted
cookie. **The token never reaches the browser** — only public profile fields
do.

Source: `apps/web/src/server/routes/auth.ts`,
`apps/web/src/server/session.ts`,
`apps/web/src/server/middleware/auth.ts`,
`apps/web/src/server/routes/me.ts`.

## OAuth web flow

### Scopes

```
repo read:org read:user
```

`repo` (private repo access), `read:org` (org membership / SSO context) and
`read:user` (profile).

### `GET /auth/login`

1. Mint a one-time state: `crypto.randomUUID()`.
2. Store it in the `OAUTH_STATE` KV namespace with a 300s TTL
   (`expirationTtl: STATE_TTL_SECONDS`), value `'1'`.
3. Set a short-lived `oauth_state` cookie (httpOnly, `SameSite=Lax`,
   `path=/auth`, `maxAge` 300s) bound to this browser.
4. Redirect to `https://github.com/login/oauth/authorize` with `client_id`,
   `redirect_uri` (`/auth/callback`), `scope` and `state`.

This is **login-CSRF protection**: the state must be both a live, one-time
server-issued token (KV) *and* match the cookie set in this browser. A state
minted in one browser cannot be completed in another.

### `GET /auth/callback`

1. Require `code` and `state` query params (else `400`).
2. Compare `state` against the `oauth_state` cookie using a constant-time
   compare (`timingSafeEqual`); mismatch → `403 invalid state`. The cookie is
   deleted regardless.
3. Confirm the state is still live in KV; consume it (`OAUTH_STATE.delete`).
   Missing → `403 invalid state`.
4. POST `code` + `client_secret` to
   `https://github.com/login/oauth/access_token`. No `access_token` →
   redirect back to `/auth/login`.
5. Fetch `/user` with the new token for the profile (login, name, avatar).
6. Seal the session (below) and set the session cookie. Redirect to `/`.

### `GET /auth/permissions`

Convenience redirect to the GitHub OAuth app settings page
(`https://github.com/settings/connections/applications/<client_id>`) so a user
can review/revoke the grant.

### `POST /auth/logout`

Deletes both possible session cookies (`__Host-session` and the dev `session`
fallback) and returns `204`. The client also wipes its persisted IndexedDB
cache on logout — see [offline-pwa](./offline-pwa.md).

## The stateless encrypted session

The session is `{ token, login, name, avatar, scopes }` sealed into a **JWE**
encrypted cookie. There is **no server-side session store** — Cloudflare keeps
nothing; the cookie *is* the session.

- **Algorithm:** JWE direct encryption — `alg: 'dir'`, `enc: 'A256GCM'`
  (AES-256-GCM), via the `jose` library.
- **Key:** `SESSION_ENC_KEY`, 64 hex chars = 32 bytes (the A256GCM key size).
  Generate with `openssl rand -hex 32`.
- **TTL:** `SESSION_TTL_SECONDS = 604800` (7 days), **sliding** — re-issued with
  a fresh expiry on every authenticated request.

```ts
export type SessionData = {
  token: string   // GitHub OAuth token — NEVER returned to the browser
  login: string
  name: string
  avatar: string
  scopes: string[]
}
```

`openSession` returns `null` on anything wrong (bad / expired / tampered),
so callers uniformly treat a broken cookie as "no session."

### Cookie attributes

`cookieAttrs(reqUrl)` picks the cookie name and `Secure` flag from the request
protocol:

- **HTTPS (prod):** `__Host-session`, `Secure`. The `__Host-` prefix requires
  `Secure` + `path=/` + no `Domain`.
- **HTTP localhost (dev):** browsers reject `__Host-` over plain HTTP, so it
  falls back to `session` without `Secure`. See
  [local-development](./local-development.md).

Both are set `httpOnly`, `SameSite=Lax`, `path=/`.

### Per-request decryption (auth middleware)

`authMiddleware` runs on every `/api/*` request:

1. Read the session cookie, decrypt it **in-CPU** (0 KV reads, 0 DB reads).
2. Attach `ctx.user` (the `SessionData`, or `null`).
3. On success, re-seal and re-set the cookie with a fresh 7-day expiry (the
   sliding TTL).
4. Never throws. Routes that require auth check `ctx.user` for `null` and
   return `401`.

## `GET /api/me`

Returns **public fields only**:

```ts
{ login, name, avatar, scopes }
```

The GitHub `token` is excluded — it never leaves the Worker. When logged out,
`/api/me` returns `401 { error: 'unauthenticated' }`; the client treats that as
a valid logged-out state (the `me` query returns `null`), not an error.

## CSRF protection

Two distinct CSRF concerns, two distinct mitigations:

- **Login CSRF** — handled by the one-time KV state token bound to the
  `oauth_state` cookie (above).
- **Mutation CSRF** — Hono's `csrf()` middleware runs ahead of
  `authMiddleware` on `/api/*`, applying Origin / `Sec-Fetch-Site` checks to
  mutating requests so a cross-site page cannot drive the authenticated API.

## The 401 → reauth bounce

A revoked or expired GitHub token surfaces as a `401` / `reauth` /
`unauthenticated` error from any read or write. The client's global TanStack
Query error handler matches that and bounces to the OAuth login:

```ts
const onError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : ''
  if (/\b401\b|reauth|unauthenticated/.test(msg)) window.location.href = '/auth/login'
}
```

The `me` query is exempt — it returns `null` on `401` (a normal logged-out
state) so it never trips the bounce. Routes that hit GitHub and get a `401`
back translate it to `{ error: 'reauth' }` so a stale token (not just a missing
cookie) also triggers re-auth. See
[api-reference](./api-reference.md#error-codes).
