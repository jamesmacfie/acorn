# Authentication

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The OAuth web flow and sealed-cookie session are unchanged — they
> run in an in-process Node server on `http://127.0.0.1:4317`, and login happens in a dedicated
> Electron OAuth window. Register `http://127.0.0.1:4317/auth/callback` on the GitHub OAuth app.
> Where this doc says "the Worker", read "the local server".

acorn authenticates users with GitHub via the OAuth 2.0 web flow. The local
server exchanges the OAuth code for an access token and seals it into an
encrypted cookie. **The token never reaches the browser** — only public profile fields
do.

> This doc covers the **internal** UI credentials (session cookie + loopback internal token). The
> optional **public automation API** is a separate transport with its own bearer tokens — see
> [API tokens](#api-tokens-public-automation-api) below and [public-api.md](./public-api.md).

Source: `apps/desktop/src/core/server/routes/auth.ts`,
`apps/desktop/src/core/server/session.ts`,
`apps/desktop/src/core/server/middleware/auth.ts`,
`apps/desktop/src/core/server/routes/me.ts`.

## OAuth web flow

### Scopes

```
repo read:org read:user
```

`repo` (private repo access), `read:org` (org membership / SSO context) and
`read:user` (profile).

### `GET /auth/login`

1. Mint a one-time state: `crypto.randomUUID()`.
2. Issue it into the `OAUTH_STATE` store (`OauthStateStore.issue` — an
   in-memory map whose 5-minute TTL is internal to the store,
   `main/bindings.ts`).
3. Set a short-lived `oauth_state` cookie (httpOnly, `SameSite=Lax`,
   `path=/auth`, `maxAge` 300s) bound to this browser.
4. Preserve the deep link: `?return_to=` is sanitized by `safeReturnTo` (must
   start with `/`, must not start with `//` — no external or protocol-relative
   URLs, preventing open redirect) and stored in a second short-lived cookie,
   `oauth_return_to` (same attributes as `oauth_state`).
5. Redirect to `https://github.com/login/oauth/authorize` with `client_id`,
   `redirect_uri` (`/auth/callback`), `scope` and `state`.

This is **login-CSRF protection**: the state must be both a live, one-time
server-issued token (in the TTL map) *and* match the cookie set in this browser.
A state minted in one browser cannot be completed in another.

### `GET /auth/callback`

1. Require `code` and `state` query params (else `400`).
2. Compare `state` against the `oauth_state` cookie using a constant-time
   compare (`timingSafeEqual`); mismatch → `403 invalid state`. The cookie is
   deleted regardless.
3. Confirm the state is still live in the TTL map; consume it (`OAUTH_STATE.delete`).
   Missing → `403 invalid state`.
4. POST `code` + `client_secret` to
   `https://github.com/login/oauth/access_token`. No `access_token` →
   redirect back to `/auth/login`.
5. Fetch `/user` with the new token for the profile (login, name, avatar);
   failure redirects back to `/auth/login`. The granted `scope` list from the
   token response is kept on the session.
6. Seal the session (below) and set the session cookie. Redirect to the
   `oauth_return_to` cookie's path (re-sanitized; default `/`), deleting that
   cookie.

### `GET /auth/permissions`

Convenience redirect to the GitHub OAuth app settings page
(`https://github.com/settings/connections/applications/<client_id>`) so a user
can review/revoke the grant. Falls back to
`https://github.com/settings/applications` when the client id is blank.

### `POST /auth/logout`

Deletes the `session` cookie and returns `204`. The client also wipes its
persisted IndexedDB cache on logout — see [caching](./caching.md).

## The stateless encrypted session

The session is `{ token, login, name, avatar, scopes }` sealed into a **JWE**
encrypted cookie. There is **no server-side session store** — the cookie *is*
the session.

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

The session cookie is named `session` (`SESSION_COOKIE` in `session.ts`), set
`httpOnly`, `SameSite=Lax`, `path=/`, without `Secure`. The server only ever
runs on plain-HTTP loopback (`http://127.0.0.1:4317`), so the `Secure` flag —
and the Workers-era `__Host-session` name, which requires it — can never
apply; that branch has been removed.

### Per-request decryption (auth middleware)

`authMiddleware` runs on every `/api/*` request:

1. Read the session cookie, decrypt it **in-CPU** (no DB reads, no session store).
2. No (or broken) cookie? Fall back to the internal loopback token (below).
3. Attach `ctx.user` (the `SessionData`, or `null`).
4. When the identity came from the cookie, re-seal and re-set it with a fresh
   7-day expiry (the sliding TTL). Internal-token callers hold no cookie and
   are not issued one.
5. Never throws. Routes that require auth check `ctx.user` for `null` and
   return `401`.

## Internal loopback auth (`x-acorn-internal`)

The acorn MCP server calls the API over loopback and holds no browser cookie.
It authenticates with the **`x-acorn-internal: <INTERNAL_TOKEN>`** header
instead. `INTERNAL_TOKEN` is a fresh `randomUUID()` minted per app run in
`apps/desktop/src/core/main/bindings.ts` and injected into task terminal sessions as
`ACORN_API_TOKEN`, so agent-spawned processes inherit it.

`internalUser` (`middleware/auth.ts`) resolves the identity as the machine's
single user — the `userId` of the first `prefs` (or `repos`) mirror row,
falling back to `'local'` — with an **empty GitHub token**. Internal callers
can therefore read local mirrors and app-state, but any route that would call
GitHub live fails with `401 reauth` (empty bearer). See
[api-reference](./api-reference.md#middleware--auth) and [mcp](./mcp.md).

## API tokens (public automation API)

The optional [public automation API](./public-api.md) does not use the cookie or the internal token —
it authenticates with **bearer API tokens** on its own loopback listener. This is a distinct principal
kind (`api-token`) that never reaches the internal `/api/*` middleware.

- **Format** `acorn_v1_<uuid>_<43-char base64url secret>`; only `SHA-256(secret)` is stored in
  `api_tokens`, and the raw token is shown once. `TokenService.authenticate` (`core/server/publicApi/
  tokenService.ts`) verifies with a constant-time hash compare and collapses every failure (missing /
  malformed / unknown / expired / revoked / wrong-secret) to one `401` so it is not a token-status
  oracle.
- **Scopes** `read` or `read + write`; revocation is immediate and also closes the token's live
  WebSockets.
- **Issuance/revocation** are **cookie-authenticated** internal operations (`/api/api-tokens`,
  `core/server/routes/apiTokens.ts`); a bearer cannot mint bearers.

Because a bearer request carries no session cookie, the GitHub credential it needs for upstream calls
is stored separately: **`/auth/callback` upserts the GitHub identity + token into `oauth_accounts`,
encrypted at rest with `SESSION_ENC_KEY`** (via `encryptSecret`, the same mechanism as integration
credentials). The public GitHub plugin resolves that credential for `api-token` principals. See
[public-api.md](./public-api.md).

## WebSocket upgrade auth (`/ws`)

The single stream socket (Phase 3, [electron §12](./electron.md)) reuses the same identity model at
the HTTP upgrade, checked in `main/wsHub.ts` **before** the handshake completes: the loopback
**Host** guard, an **exact-Origin** match, and a valid **session cookie** — or the
**`x-acorn-internal`** token (the loopback MCP caller, which carries no cookie/Origin). Any failure
returns `403` and the socket is destroyed. Same cookie, same token, same single-user machine as the
HTTP surface — no new credential kind. (The public API's WebSocket at `/api/v1/ws` is a separate,
bearer-authenticated socket on the public listener — see [public-api.md](./public-api.md).)

## `GET /api/me`

Returns **public fields only**:

```ts
{ login, name, avatar, scopes }
```

The GitHub `token` is excluded — it never leaves the local server. When logged out,
`/api/me` returns `401 { error: 'unauthenticated' }`; the client treats that as
a valid logged-out state (the `me` query returns `null`), not an error.

## CSRF protection

Two distinct CSRF concerns, two distinct mitigations:

- **Login CSRF** — handled by the one-time in-memory state token bound to the
  `oauth_state` cookie (above).
- **Mutation CSRF** — Hono's `csrf()` middleware runs ahead of
  `authMiddleware` on `/api/*`, applying Origin / `Sec-Fetch-Site` checks to
  mutating requests so a cross-site page cannot drive the authenticated API.

## The 401 → reauth bounce

A revoked or expired GitHub token surfaces as a `401` / `reauth` /
`unauthenticated` error from any read or write. The client's global TanStack
Query error handler matches that and bounces to the OAuth login:

```ts
// apps/desktop/src/app/client/index.tsx
const onError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : ''
  if (/\b401\b|reauth|unauthenticated/.test(msg))
    window.location.href =
      '/auth/login?return_to=' + encodeURIComponent(window.location.pathname + window.location.search)
}
```

The current location rides along as `return_to`, so the user lands back where
they were after re-auth (see `GET /auth/login` above).

The `me` query is exempt — it returns `null` on `401` (a normal logged-out
state) so it never trips the bounce. Routes that hit GitHub and get a `401`
back translate it to `{ error: 'reauth' }` (via the shared `ghError()` helper)
so a stale token (not just a missing cookie) also triggers re-auth. See
[api-reference](./api-reference.md#error-codes).

