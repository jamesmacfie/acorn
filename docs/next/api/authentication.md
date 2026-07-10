# Authentication and authorization

## 1. Public credential model

Every public HTTP request uses:

```http
Authorization: Bearer acorn_v1_<token-id>_<secret>
```

The token contains:

- a version marker (`v1`) so token parsing can evolve independently of API versioning;
- an opaque UUID token id used for a single indexed database lookup;
- 32 random bytes encoded as unpadded base64url.

The complete token is shown exactly once at creation. Acorn stores only the token id, a short
display prefix, and `SHA-256(secret)` as a 32-byte blob. A 256-bit random secret makes offline hash
guessing infeasible; adding a user password or reversible token encryption would not improve the
local threat model. Compare hashes with `timingSafeEqual`.

Never accept tokens in a query string, cookie, JSON body, command argument, or WebSocket URL. Query
tokens leak through logs, history, process listings, and proxy diagnostics.

## 2. Scopes

The only public scopes in `v1` are:

```ts
const ApiScopeSchema = z.enum(['read', 'write'])
const ApiScopesSchema = z.union([
  z.tuple([z.literal('read')]),
  z.tuple([z.literal('read'), z.literal('write')]),
])
```

Rules:

- a read-only token has `['read']`;
- a writable token has `['read', 'write']`;
- `['write']`, duplicates, unknown scopes, and a different order are invalid;
- `GET`/`HEAD` and read-only stream subscriptions require `read`;
- every durable mutation, process spawn/input/signal, Git operation, upstream mutation, database
  query, UI command, and API setting change requires `write`;
- endpoint definitions declare the required scope; handlers do not perform ad-hoc checks.

The user requested read/write scopes, so `v1` deliberately does not introduce `execute`,
`tokens:manage`, or per-plugin scopes. Endpoint risk metadata may still label operations for UI
display and audit, but it is not an authorization dimension.

## 3. Persistent schema

Add these core app-state tables:

```ts
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  secretHash: blob('secret_hash', { mode: 'buffer' }).notNull(),
  canWrite: integer('can_write', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
}, (t) => [
  index('api_tokens_user_created_idx').on(t.userId, t.createdAt),
  index('api_tokens_active_idx').on(t.id, t.revokedAt),
])

export const oauthAccounts = sqliteTable('oauth_accounts', {
  userId: text('user_id').primaryKey(),
  provider: text('provider').notNull(), // v1: 'github'
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  login: text('login').notNull(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  scopesJson: text('scopes_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
```

Use the existing `encryptSecret`/`decryptSecret` primitives and `SESSION_ENC_KEY` for the upstream
token. Do not reuse reversible encryption for the API bearer secret.

`api_tokens.user_id` links the bearer to the OAuth account that existed at issuance. It is not a
multi-tenant access-control boundary; it preserves Acorn's current login-switch semantics.

## 4. Token administration

Token administration is an interactive, cookie-authenticated settings surface on the existing
`4317` app listener. It is not mounted on the public listener.

### `GET /api/api-tokens`

Returns metadata only:

```ts
const ApiTokenSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: ApiScopesSchema,
  createdAt: UnixMillisSchema,
  lastUsedAt: UnixMillisSchema.nullable(),
  expiresAt: UnixMillisSchema.nullable(),
  revokedAt: UnixMillisSchema.nullable(),
})
```

### `POST /api/api-tokens`

Cookie session + CSRF required.

```ts
const CreateApiTokenSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scopes: ApiScopesSchema,
  expiresAt: UnixMillisSchema.nullable().default(null),
})

const CreatedApiTokenSchema = z.strictObject({
  token: z.string(), // present only in this response
  metadata: ApiTokenSummarySchema,
})
```

Reject expiry values in the past. Maximum expiry is optional; if imposed, document it as an API
policy and validate it here.

### `DELETE /api/api-tokens/:id`

Cookie session + CSRF required. Idempotently stamps `revokedAt`. Returns `204` whether the token was
already revoked, but returns `404` if it never belonged to the current user.

### Why bearer tokens cannot mint tokens

With only `read` and `write`, allowing a write token to mint another token would let a stolen token
create an untracked replacement before revocation. A future explicit administration scope could
change this, but `v1` keeps issuance and revocation in the authenticated desktop settings ceremony.

## 5. Bearer principal

Extend the principal union without changing existing browser/internal behavior:

```ts
type Principal =
  | { kind: 'user'; user: SessionUser }
  | { kind: 'internal'; user: SessionUser }
  | {
      kind: 'api-token'
      user: SessionUser
      tokenId: string
      scopes: readonly ['read'] | readonly ['read', 'write']
    }
```

The public app factory resolves **only** the `api-token` branch. It must not accept the session
cookie or `x-acorn-internal`. The internal app factory keeps its existing principal resolver and
does not start accepting public bearer tokens accidentally.

Authentication algorithm:

1. require exactly one RFC 6750-style `Authorization: Bearer <value>` header;
2. parse the anchored token grammar and reject extra whitespace/components;
3. load `api_tokens` by id;
4. reject missing, revoked, or expired rows;
5. hash the presented secret and compare in constant time;
6. load the linked OAuth account metadata;
7. attach the principal and required-scope helper;
8. asynchronously throttle `lastUsedAt` updates (at most once per token per five minutes).

Do not cache positive token validity across requests unless revocation has an explicit synchronous
cache invalidation path. The simplest correct `v1` implementation performs the indexed SQLite
lookup on each request.

## 6. Revocation contract

After revocation:

- all new HTTP requests using that token return `401`;
- error code is `invalid_token` for missing, malformed, unknown, expired, and revoked tokens so the
  endpoint does not become a token-status oracle;
- response includes `WWW-Authenticate: Bearer realm="acorn", error="invalid_token"`;
- all public WebSocket connections authenticated by that token are closed with application close
  code `4401` and reason `token revoked`;
- pending UI-control commands from that token are cancelled before dispatch when possible; commands
  already acknowledged may have completed and are represented by their normal event/audit trail;
- subsequent reconnect/HTTP attempts receive `401`.

The token service publishes `auth.token.revoked { tokenId }` in-process. The public WebSocket hub
indexes connections by token id and closes them synchronously from that notification.
Revoking the last token does not stop the public listener; a subsequent use of that revoked token
must reach the listener and receive `401`.

## 7. GitHub credential persistence and upstream auth

On every successful `/auth/callback`:

1. build the existing encrypted session cookie unchanged;
2. encrypt the GitHub access token with `SESSION_ENC_KEY`;
3. upsert `oauth_accounts` for the login inside the local DB;
4. store public profile fields and normalized OAuth scopes;
5. never return or log the access token.

For a bearer request to a GitHub endpoint, the GitHub plugin resolves and decrypts the account
credential from the principal's `userId`. Internal principals continue to receive no upstream
credential. Provider tokens continue to resolve from the integration connection store.

If GitHub rejects the stored token:

```json
{
  "error": {
    "code": "upstream_reauthentication_required",
    "message": "GitHub authorization must be renewed in Acorn.",
    "requestId": "...",
    "details": { "provider": "github" }
  }
}
```

Return `424 Failed Dependency`, not `401`. `401` describes the Acorn bearer. This distinction lets
automation decide whether to replace its API token or ask the user to reauthenticate GitHub.

Logging out of the browser clears the browser session but does not revoke API tokens. Explicitly
disconnecting the GitHub account (if/when added) must revoke its API tokens, remove the stored
upstream credential, and close their sockets atomically.

## 8. Public listener security

- bind only `127.0.0.1`;
- enforce `Host === 127.0.0.1:<configured-port>` on HTTP and upgrades;
- emit no `Access-Control-Allow-Origin` headers and reject `OPTIONS` unless a documented endpoint
  explicitly needs it (none do in `v1`);
- do not use cookie auth, so CSRF middleware is neither needed nor appropriate on the public app;
- cap JSON bodies at 1 MiB by default, with smaller per-endpoint limits where specified;
- cap header size through the Node server and reject duplicate Authorization headers;
- rate-limit failed bearer authentication by loopback client/process-observable bucket without
  locking out valid tokens; successful local automation should not receive arbitrary rate limits;
- redact `authorization`, tokens, cookies, provider credentials, database URLs, terminal input,
  file bodies, command strings, environment maps, and upstream bodies from logs;
- log request id, operation id, principal/token id, status, duration, and affected resource ids;
- require `write` for all endpoints whose implementation can execute code, even if the method is
  named “query” or “preview”.

## 9. Authentication test matrix

Every contributed endpoint is automatically exercised with:

| Case | Expected |
| --- | --- |
| no Authorization header | `401 invalid_token` |
| malformed scheme/token | `401 invalid_token` |
| unknown token id | `401 invalid_token` |
| wrong secret | `401 invalid_token` |
| expired token | `401 invalid_token` |
| revoked token | `401 invalid_token` |
| read token on read endpoint | success |
| read token on write endpoint | `403 insufficient_scope` + `WWW-Authenticate` scope hint |
| write token on read/write endpoint | success |
| cookie only | `401 invalid_token` |
| internal token only | `401 invalid_token` |
| wrong Host | `403 forbidden_host` before route handling |
| revoked token with open socket | socket closes `4401`; reconnect gets `401` |
