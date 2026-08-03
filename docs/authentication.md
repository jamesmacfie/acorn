# Authentication

**There is no login.** acorn has no user accounts, no session, and no cookie. It is single-owner
software: whoever can reach a node's data root is the owner, and the only question the transport asks
is *"is this client one the owner paired?"*.

Three things went away in vNext Phase 1, and none of them is coming back:

- the **GitHub OAuth web flow** and its `/auth/*` routes, the sealed-cookie session (`session.ts`), and
  the login-gated UI. GitHub is now an ordinary stored integration credential, connected by the OAuth
  **device flow**;
- Hono's **`csrf()`** middleware — see [why](#why-there-is-no-csrf-middleware);
- the bearer-authenticated public automation API (`/api/v1`), its tokens and idempotency store, deleted
  in Phase 0 along with `oauth_accounts`, `api_tokens`, `api_idempotency` and `command_executions`.

Source of truth for everything below:
`packages/node-core/src/server/middleware/auth.ts`,
`packages/node-core/src/server/middleware/requireUser.ts`,
`packages/node-core/src/server/auth/deviceTokens.ts`,
`packages/node-core/src/server/auth/pairingCodes.ts`,
`packages/node-core/src/server/routes/pairing.ts`,
`packages/node-core/src/main/tls.ts`,
`apps/desktop/src/app/main/nodeBroker.ts`,
`apps/desktop/src/app/main/nodePairing.ts`,
`apps/desktop/src/app/main/deviceTokenStore.ts`,
`plugins/github/src/server/routes/deviceAuth.ts`,
`plugins/github/src/server/githubToken.ts`.

## The two principals

```ts
type Principal = { kind: 'device' | 'internal'; userId: string; deviceId?: string }
```

| Kind | Credential | Who |
| --- | --- | --- |
| `device` | `Authorization: Bearer acorn_dt_…` | a paired client. **Full owner authority**, by design — disclosed at pairing, which is why there are no scopes. |
| `internal` | `x-acorn-internal: <INTERNAL_TOKEN>` | a child process this node spawned (the MCP server, command-variable executions). Cannot use the HTTP client as a secret oracle (`plugins/http` requires `kind === 'device'`) and cannot reach the renderer-facing tool projection. See [the GitHub caveat](#the-internal-principal-can-now-reach-github). |

`userId` is the owner's GitHub login — the scope key for every user-scoped table — resolved from the
data root's `active-identity` binding, which connecting GitHub writes. `deviceId` is set only for
`kind: 'device'`; the internal principal has no device row to revoke.

There used to be a third kind, `user`, carrying a whole `SessionUser` decrypted out of the cookie —
including the GitHub token. Both are gone: a device is an **identity**, not a provider credential.

### The gate

`createApp()` mounts, in this order, once, over `/v2/*`:

1. `requestIdMiddleware` (`*`, unconditional) — assigns or echoes `X-Request-Id`.
2. `authMiddleware` — resolves `c.principal` from a bearer or the internal token. Never throws, never
   enforces. A **presented bearer that fails does not fall through** to the internal token: presenting a
   credential and having it rejected is a rejection, not an invitation to try the next mechanism.
3. `pairing.open` — `GET /v2/node` + `POST /v2/pair`, the two pre-auth routes (see below).
4. `requireUser` — the single 401 gate. No principal → `401 unauthenticated`.
5. `idempotency` — below the gate on purpose, because replay is keyed on `deviceId`.
6. every core and plugin router.

A router mounted above `requireUser` would be an unauthenticated hole; `ownerId(c)` is safe only
downstream of it, and gate and reader share the one context slot so they cannot desync.

## Transport: TLS 1.3 and a pinned certificate

There is no CA and no hostname validation anywhere in this system. **The certificate is the identity.**

- On first start a node mints a long-lived (20-year) self-signed certificate into `<dataRoot>/tls/`
  by shelling out to `openssl req -x509` (`main/tls.ts`). It is reused for the node's whole life:
  regenerating it would look to every paired client exactly like the attack the pin exists to catch.
- The fingerprint is `sha256` of the DER, lowercase hex, no separators.
- Two extensions are set explicitly and are load-bearing beyond "the handshake works":
  `basicConstraints CA:TRUE` lets the one file double as a trust anchor, so a spawned child gets **full**
  validation from `NODE_EXTRA_CA_CERTS` with zero code; `subjectAltName IP:127.0.0.1` is what makes that
  child's hostname check pass instead of having to be disabled. `rejectUnauthorized: false` appears
  exactly once in the codebase — in the pairing probe, next to the reason.
- The listener serves HTTPS with `minVersion: 'TLSv1.3'` on an **ephemeral port**. Every client is one we
  ship (the broker's `https.Agent`, `ws`, and Node children), so there is no legacy peer to accommodate.
- A **loopback Host guard** rejects any `Host` other than the `127.0.0.1:<port>` the node actually bound,
  so a DNS-rebinding page cannot reach the local API as some other origin.

The renderer never performs any of this. It loads from `app://acorn` and calls
`window.acorn.nodeFetch(nodeId, …)`; **Electron main's connection broker** owns the pinned agent and the
bearer. A changed fingerprint is a hard stop with no retrust affordance — the broker stops reconnecting
and Settings → Nodes shows the pinned and presented values side by side.

## Device tokens

```
acorn_dt_<uuid>_<base64url(32 random bytes)>
```

- The raw token exists exactly once, in the pairing response. Only `sha256(secret)` is stored in
  `devices`; a 256-bit secret makes offline hash guessing infeasible, so nothing reversible is layered on.
- `authenticate()` returns `{ deviceId }` or **`null`** — and missing, malformed, unknown, revoked and
  wrong-secret all return that same `null`. The uniformity is the point: distinguishing them would make
  this a token-status oracle. The compare is `timingSafeEqual` after a length check.
- `lastSeenAt` is updated at most every 5 minutes, fire-and-forget, so a write failure never fails
  authentication.
- **Revocation is immediate.** `DELETE /v2/core/devices/:id` sets `revokedAt`; the next request is
  unauthenticated, and `onRevoked` fires so the WS hub closes that device's live sockets at once. A
  60-second sweep re-checks `isActive()` as a backstop, because a long-lived stream holds no bearer to
  re-present. A device may revoke **itself** — that is "unpair this machine" — so there is deliberately
  no self-revocation guard.
- Custody on the client is `main/deviceTokenStore.ts`: one Electron `safeStorage` blob per scope, where a
  scope is a `nodeId` (or the constant `local` for the bundled node, whose token must be read *before*
  the service starts and therefore before its nodeId is known). On macOS `safeStorage` is the Keychain,
  which is why data.md's "OS keychain" needs no `keytar`. A machine with no usable keychain simply does
  not remember the token and re-pairs — which is why the fleet record (`fleet.json`) and the token are
  separate files.

## Pairing

Pairing is how a client with no credential gets one. It is owner-initiated on **both** ends.

1. **Open a window** on the node — `POST /v2/core/pair/start`, from an already-paired client. The node
   mints a 128-bit code, returns it as plaintext (the caller *is* the node's UI and has to display it),
   and reports `expiresInMs`. 10 minutes, 5 attempts, single use, held in memory only: a code that
   survived a restart would be a credential on disk for a window the owner believes has closed. Issuing
   again replaces the live code, which is also how "regenerate" works. At most one window at a time.
2. **Probe** — `GET /v2/node`. Unauthenticated it returns *only* `{ protocolVersion, fingerprint }`;
   authenticated it adds `nodeId` and `appVersion`. `main/nodePairing.ts` makes this one request
   unverified (there is nothing to trust yet), captures the certificate off the socket, and checks that
   the fingerprint the **socket** presented matches the one the **body** claims — which is what catches a
   middlebox re-terminating TLS and forwarding the real node's response.
3. **The owner compares the fingerprint** against what the node itself displays. *This comparison is the
   security of pairing.* Reading a fingerprint over the very connection being authenticated proves
   nothing; acorn cannot check it for the owner. Settings → Nodes makes it a deliberate screen with the
   value in front of them, not a checkbox beside a URL field.
4. **Spend the code** — `POST /v2/pair`, now over a **pinned** connection. The node creates a `device`
   row and returns `{ deviceToken, nodeId, device }`.

Every pairing failure is **byte-identical**: same 401, same `pairing_failed` code, same message, no
details. A malformed body, no open window, an expired window, an exhausted attempt budget and a wrong
code are indistinguishable. A malformed body short-circuits *before* `consume()`, so it cannot spend one
of the five attempts. On top of the per-window budget, one un-keyed ceiling of 20 attempts per minute on
the route bounds churn across reopened windows (`429 rate_limited`); it is deliberately not keyed by
caller, because a loopback/LAN peer's address is not an identity and keying a map on hostile input is an
unbounded allocation.

**Local bundle: no code.** The client spawned the node, which is proof enough of owner intent. The node
reports `{ nodeId, endpoint, deviceToken, fingerprint, certPem }` from `service.start`, reusing the token
the parent passed back when it still authenticates — so the steady state is one device row, not one per
launch — and issuing a fresh one otherwise. The node never persists it; custody belongs to the client.

### Administration

| Route | Purpose |
| --- | --- |
| `POST /v2/core/pair/start` | open a pairing window; returns `{ code, expiresInMs }` |
| `DELETE /v2/core/pair` | close it. Idempotent — closing a closed window is `204`, not `404` |
| `GET /v2/core/devices` | list paired devices. Carries **no** token material |
| `DELETE /v2/core/devices/:id` | revoke. `204`, or `404` only if the device never existed |

**Unpair vs revoke** are labelled distinctly in the UI on purpose: unpair is this client forgetting the
node (recoverable with a new pairing code), revoke is the node tearing up this client's credential.
Confusing them is how an owner loses access to a remote node.

## Internal loopback auth (`x-acorn-internal`)

A child process this node spawned holds no device token. It sends `x-acorn-internal: <INTERNAL_TOKEN>`
instead — random material persisted mode `0600` in the data root and **deliberately reused across boots**,
because an agent pane running in tmux is reattached after a restart and would otherwise 404 every
MCP / notes / memory / context call. Children receive it as `ACORN_API_TOKEN`, alongside
`ACORN_DATA_DIR` (from which they resolve the *current* port out of `node.json` — a baked URL cannot
survive an ephemeral port) and `NODE_EXTRA_CA_CERTS` pointing at the node's certificate.

The identity comes from the explicit `active-identity` binding — written by the GitHub device-flow
connect, the only `ACTIVE_IDENTITY.set()` call in the tree — and **fails closed** when nothing is bound:
guessing from a first `prefs`/`repos` row is nondeterministic and could select another identity's mirror.
There is no logout to clear it any more. See [mcp](./mcp.md).

### The internal principal can now reach GitHub

This is a **deliberate consequence of moving the credential, and a change in posture from V1** — call it
out rather than assume the old guarantee.

V1's internal principal carried a `SessionUser` with an empty `token`, so an agent-spawned child was
*structurally* unable to call GitHub: the bearer it would have sent was `''`. That mechanism is gone.
`githubToken(c)` reads the encrypted `integrations` row for `ownerId(c)`, `ownerId` returns
`principal.userId` for **either** kind, and `requireUser` lets either kind pass. Nothing in the github
plugin's routers gates on principal kind, so an internal caller reaching `/v2/p/github/…` spends the
owner's token exactly as a paired client does.

The only kind-based gates that exist are `routes/agentTools.ts` (the renderer projection requires
`device`; the MCP projection requires `internal`) and `plugins/http/src/server/routes/http.ts`
(`send` requires `device`, `403 interactive_user_required`).

Whether that is acceptable is a real decision, not an oversight to route around: every process this node
spawns is one the owner started, and the agent could equally read the token out of a `gh` CLI config. But
"an agent cannot exfiltrate or spend your GitHub credentials through the MCP surface" is **no longer
true**, and any doc still saying so is wrong.

## GitHub: the device authorization grant

GitHub is an ordinary row in `integrations`, encrypted at rest with `SESSION_ENC_KEY`, connected from
Settings → Integrations. Scopes are unchanged: `repo read:org read:user`.

| Route | Purpose |
| --- | --- |
| `POST /v2/p/github/auth/device/start` | asks GitHub for a device code; returns `{ deviceCode, userCode, verificationUri, expiresIn, interval }` |
| `POST /v2/p/github/auth/device/poll` | one poll attempt. `{ status: 'pending' \| 'connected' \| 'denied' \| 'expired' }` |

RFC 8628 was chosen over the redirect web flow for three reasons, in order of weight:

1. **No client secret.** The web flow needs one to exchange the code, and a secret shipped inside a
   distributed binary is recoverable — a caveat V1 documented and could not fix. Nothing reads
   `GITHUB_CLIENT_SECRET` any more. (The binding is still declared and read *optionally*, at the owner's
   explicit request. `GITHUB_CLIENT_ID` **is** required to boot a node.)
2. **No redirect URI.** The renderer has no server-served origin to redirect back to, and a remote node
   would need its own registered callback URL. So **there is no callback to register** — the old
   `http://127.0.0.1:4317/auth/callback` registration is dead, and could not have survived an ephemeral
   port anyway. What the OAuth app *does* need is **Enable Device Flow** turned on.
3. **No auth `BrowserWindow`.** The intercept-navigation dance in Electron main is gone; no window of
   ours ever visits github.com.

The cost is one extra user action: the owner reads a code and types it at the verification URI.

`poll` never long-polls (that would tie up a request slot for up to 15 minutes per pending connection) —
the client drives the interval GitHub advertises and never polls faster. The `device_code` is returned to
the client rather than held server-side: it authorizes nothing on this node, and per-owner pending state
would only add a lifecycle to get wrong. On success the token goes through the same `connectProvider`
path every other provider uses (validate against `GET /user`, record granted scopes, encrypt at rest,
enforce `maxConnections`), and the machine's `active-identity` is bound to the resulting account so
internal callers resolve to it. The token itself is never echoed back.

### Reading the credential

`githubToken(c)` (`plugins/github/src/server/githubToken.ts`) is the **single** read site — it used to be
`getUser(c).token` at 34 call sites. It returns `''` rather than throwing when GitHub is not connected;
`gh()`/`ghGraphQL()` turn an empty token into the same synthetic 401 a rejected token produces, which
`ghError()` normalizes to `reauth`. There is deliberately **no fallback**: keeping the transitional
session-cookie fallback past the cookie's deletion would make a *missing* credential ("never connected")
indistinguishable from a revoked one, which is a materially different thing to tell the user.

## WebSocket upgrade auth (`/v2/events`)

One socket per node per client, authorized in `main/wsHub.ts` **before** the handshake completes:

- the loopback **Host** guard (same value the HTTP path enforces);
- a device **bearer** in the upgrade headers, or the **`x-acorn-internal`** token.

There is **no Origin check and no cookie**. A broker socket from Electron main is not a browser socket,
and with no ambient credential left there is nothing for an Origin check to defend. A presented-but-bad
bearer does not fall back to the internal token. Any failure is a `403` and the socket is destroyed.

A revoked device's sockets close immediately via `onRevoked`, plus the 60-second sweep as a backstop. An
internal-token socket survives a device revocation — revocation is per-device, and a child process has no
device row.

## Why there is no CSRF middleware

CSRF defends **ambient** credentials: a browser attaches a cookie to a cross-site request whether or not
the page meant to send it, so the server must ask "did a page I trust initiate this?". This app has no
ambient credential. Every request carries a bearer held in Electron main, nothing a cross-site page can
do makes anything attach it, and under `app://acorn`'s CSP (`connect-src 'self'`) the renderer cannot open
a connection to a node at all.

Reinstating `csrf()` over `/v2` would also break correct callers: `hono/csrf` treats a *missing*
content-type as form-submittable and 403s any bodyless mutation — `DELETE /v2/core/devices/:id`, for one.
That exact regression is guarded by a test in `apps/node/test/integration/pairing.test.ts`.

## What replaced the 401 → reauth bounce

There is no global 401 handler in the renderer any more. A 401 used to mean "the GitHub session expired,
bounce to OAuth"; with bearer auth held by the broker it means **the device was revoked** — which the
broker observes itself and reports as a node connection state, not something a query error should
navigate on. Only the auth gate's own answer counts as revocation: `401` whose envelope code is
`unauthenticated`. A route-level `401`/`403` about a *third-party* credential
(`provider_not_connected`, `linear_reauth`, `provider_needs_auth`) is a different statement about a
different credential and must not mark the node revoked.

A stale or missing GitHub credential surfaces as `reauth` from the affected read, and the fix is
reconnecting GitHub in Settings → Integrations. See [api-reference](./api-reference.md#error-codes).

## Secrets

`SESSION_ENC_KEY` outlived the session its name refers to: it is the AES-256-GCM (JWE `dir`) key that
`server/secretBox.ts` uses to encrypt integration tokens and HTTP-client fields **at rest**. Exactly 64
hex chars (`openssl rand -hex 32`); anything else is rejected. In packaged builds it self-provisions via
Electron `safeStorage` (`main/sessionKeyStore.ts`); an environment value wins and is migrated into
safeStorage, and an existing database with neither fails closed rather than silently starting with data
it cannot read.
