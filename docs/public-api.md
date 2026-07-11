# Public automation API

A **bearer-authenticated HTTP + WebSocket automation API** that inspects and controls acorn with the
same semantic reach as the desktop UI: configure repositories in workspaces, create and archive
tasks, drive panes and terminals, run commands, edit files, perform Git and GitHub operations, and
control workflows. It is a **second transport boundary, not a second backend** — it shares one
runtime, database, registries, and application services with the internal UI API.

This is distinct from the internal, cookie-authenticated `/api/*` surface the SPA uses (see
[api-reference.md](./api-reference.md)). The public API is schema-first, versioned (`/api/v1`), and
generates its own OpenAPI.

> **Disabled by default.** Nothing is exposed until the user enables the listener and mints a token
> in Settings. A **write** token can run arbitrary commands as the local user — see
> [security.md](./security.md).

Source: `apps/desktop/src/core/{shared,server,main,client}/publicApi/*`,
`apps/desktop/src/app/server/publicApi.ts`, plugin `server/publicApi.ts` files, and the internal
management routes `apps/desktop/src/core/server/routes/{apiTokens,apiSettings}.ts`.

## Dedicated loopback listener

The public API runs on its **own** `@hono/node-server` listener in the Electron main process,
separate from the `:4317` SPA/internal listener. Keeping them separate means changing the API port
never touches the SPA origin, OAuth callback, or IndexedDB origin.

- **Bind address is constant: `127.0.0.1` only.** Not configurable. A Host-header guard runs *before*
  Hono and rejects any `Host` other than `127.0.0.1:<port>`, limiting DNS-rebinding.
- **Port is configurable** (default `4318`; `4317` is reserved for the app listener). `ACORN_API_PORT`
  overrides and *pins* the port — a port change is then refused with `setting_overridden` until
  restart.
- **Settings live in `<dataRoot>/api-settings.json`** (`{ version: 1, enabled, port }`), written
  atomically (temp file + fsync + rename, mode `0600`). It is machine-scoped, not a GitHub-user pref,
  because the port must be known before any user logs in. A corrupt/unknown-version file **fails
  closed to disabled** and surfaces an error.
- **Transactional rebind:** a port change binds the new listener first, persists only once it is
  listening, then stops the old one after the current response flushes. A bind failure keeps the
  prior listener and settings (`port_in_use`).

Lifecycle is owned by `AutomationApiServer` (`core/main/publicApi/server.ts`) and wired in
`app/main/bootstrap.ts` after the DB/services are built and before the window opens; it stops first
on teardown.

## Authentication

Every HTTP route and the WebSocket upgrade require a bearer token. There are **no** anonymous health,
discovery, documentation, or plugin routes, and the public app rejects cookie/internal-token auth.

### Tokens

- **Format:** `acorn_v1_<uuid>_<43-char base64url secret>` (a 256-bit random secret).
- **Storage:** only `SHA-256(secret)` is persisted in `api_tokens`; the raw token is shown **once**
  at creation and never again. Lookups are by the embedded token id, then a constant-time hash
  compare. `authenticate()` returns `null` for missing/malformed/unknown/expired/revoked/wrong-secret
  alike, so the endpoint is not a token-status oracle. `last_used_at` is updated off the request path,
  throttled to once per 5 minutes.
- **Scopes:** a token is either `read` or `read + write` (`write` is never issued alone). Process
  execution, terminal input, Git/file mutation, UI control, SQL, and upstream mutations all require
  `write`; a write endpoint hit with a read token returns `403 insufficient_scope`.
- **Revocation is immediate:** a revoked token returns `401` on its next HTTP call, and the token
  service notifies listeners so the public WS hub synchronously closes that token's sockets.
- **Principal kind `api-token`.** This kind exists only in the public app's context; existing
  internal middleware does not accept it.

Token source: `core/server/publicApi/tokenService.ts`; schema `api_tokens` / `oauth_accounts` in
`core/server/db/schema.ts`.

### Persistent GitHub identity

A bearer caller has no session cookie, so the GitHub credential needed for upstream calls is stored
separately: `/auth/callback` upserts the user's GitHub identity + token into `oauth_accounts`,
encrypted at rest with `SESSION_ENC_KEY` (same `encryptSecret` used for integration credentials). The
public GitHub plugin resolves that credential for `api-token` principals. See
[authentication.md](./authentication.md).

### Managing tokens and the listener

Token issuance/listing/revocation and enabling the listener are **cookie-authenticated** internal
operations — a bearer cannot mint replacement bearers. They live at `/api/api-tokens` and
`/api/settings/api` (`core/server/routes/{apiTokens,apiSettings}.ts`) and drive the **Settings → API**
page (`core/client/settings/ApiSettings.tsx`): enable/disable, effective bind address, port edit (with
the `ACORN_API_PORT`-override explanation), the create dialog (`read` vs `read + write`, expiry), the
show-once secret, and revoke — plus the explicit warning that write tokens run arbitrary local
commands.

## Protocol

- **Base path:** core endpoints at `/api/v1/<path>`; plugin endpoints at
  `/api/v1/plugins/<pluginId>/<path>`.
- **Schemas are executable.** Every path/query/header/body/response uses a strict Zod schema; unknown
  object keys and invalid discriminants fail validation at runtime. The same registry generates
  OpenAPI, so the contract cannot drift from the handler.
- **Envelopes:** success responses wrap data in a data envelope; errors use a stable
  `PublicApiError` envelope with machine codes (`insufficient_scope`, `endpoint_not_found`,
  `bad_request`, `idempotency_conflict`, `setting_overridden`, `port_in_use`,
  `capability_unavailable`, `internal_error`, …) — `core/shared/publicApi/errors.ts`.
- **Idempotency:** endpoints marked `optional`/`required` honor an `Idempotency-Key` header; a replay
  with the same key returns the stored response, and reuse with a *different* request body is
  rejected with `idempotency_conflict`. Records live in `api_idempotency` and are swept on a
  maintenance cleanup.
- **Request ids** are assigned per request and echoed.
- **`dev:node` / no-renderer:** main- or Electron-dependent operations return
  `capability_unavailable` when their capability is absent; core server endpoints still work.

## Endpoint families

The exhaustive, always-current list is the generated document at **`GET /api/v1/openapi.json`**
(bearer-gated). The registry is frozen at composition (`core/server/publicApi/registry.ts`); the app
factory is `createAutomationApp()` (`core/server/publicApi/app.ts`).

| Family | Where | Surface |
| --- | --- | --- |
| **System / discovery** | `coreSystem.ts` | `GET /health`, `/capabilities`, `/principal`, `/plugins`, `GET`/`PATCH /settings/api` |
| **Resources** | `coreResources.ts` + `services/{workspace,task}Service.ts` | workspaces, tasks (create/patch/archive/restore/links), repository assignments, pinned repos, workspace projects |
| **Integrations** | `coreIntegrations.ts` | third-party connection lifecycle (credentials are provider-declared and write-only) |
| **Commands** | `coreCommands.ts` + UI broker | typed presentation commands (focus task, pane/drawer/overlay control) — projected to the renderer, so they return `409 ui_unavailable` with no live window |
| **Plugins** | `plugins/<id>/server/publicApi.ts` | see below |

Contributing plugins (each under `/api/v1/plugins/<id>`): `terminal`, `changes` (Git/worktree),
`editor` (file list/read/write, search), `github` (PR reads + mutations, Actions), `notes`, `memory`,
`workflows`, `preview`, `database`, `linear`, `rollbar`. Plugins contribute **endpoints only** —
event channels and commands are core-declared. Contributions are assembled in
`app/server/publicApi.ts`; the registry `freeze()` enforces the shared invariants (namespaced
operation/route ids, strict-object schemas, the mutating-⇒-`write`-scope rule, plugin-relative paths)
so a malformed contribution cannot mount.

The GitHub plugin's PR reads remain mirror-only. Write-scoped automation can synchronously refresh
the first 100 open PRs for a repository with
`POST /api/v1/plugins/github/repos/:owner/:repo/pulls/refresh`, or refresh one PR's composite detail
and changed files with `POST /api/v1/plugins/github/repos/:owner/:repo/pulls/:number/refresh`.
Both return `{ data: { refreshed: true }, requestId }`; callers then use the normal read endpoints.

## WebSocket events (`/api/v1/ws`)

A separate bearer-authenticated socket (`core/main/publicApi/wsHub.ts`), attached to the automation
listener's `upgrade` event so it shares the loopback bind + Host guard. It is **distinct from** the
internal renderer WebSocket (`/ws`) — different credential, different clients — but shares the
underlying event/terminal services via the in-process `EventBus` (`core/main/publicApi/eventBus.ts`).

- Connections are **indexed by token id**; revocation closes them synchronously with a token-revoked
  close code.
- Clients subscribe with typed frames and channel/entity filters (with bounded `after`-cursor
  replay); the hub delivers core events (`core.workspace.*`, `core.task.*`,
  `core.api.settings.updated`) and terminal output streams (raw commands are never sent).
  `terminal.input` requires **write** scope.
- Heartbeat (30s), a 1 MiB max frame size, and a per-connection violation budget bound abusive or
  slow consumers.

## Boundaries

"Everything available in the UI" means every **serializable product operation** has an API home — not
that raw Electron handles are exposed:

- No native folder chooser, no raw `WebContentsView`/DevTools handles, no arbitrary SQLite access (the
  database plugin operates only on the task-configured Postgres connection).
- OAuth login and the one-time token display stay interactive; a `write` bearer cannot mint bearers.
- Quitting the app is intentionally not a `v1` command.

## Tests

Registry/auth/settings/token/idempotency unit tests and per-surface conformance suites live beside the
code under `core/{server,main,client}/publicApi/*.test.ts` (e.g. `registry.test.ts`,
`tokenService.test.ts`, `app.test.ts`, `wsHub.test.ts`, `settingsStore.test.ts`,
`coreResources.test.ts`) plus the management-route tests `routes/apiTokens.test.ts` /
`apiSettings.test.ts`. See [testing.md](./testing.md).

**See also:** [authentication.md](./authentication.md) · [security.md](./security.md) ·
[api-reference.md](./api-reference.md) · [plugins.md](./plugins.md) ·
[architecture-overview.md](./architecture-overview.md)
