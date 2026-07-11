# Security model

acorn is a local, single-user Electron application, but its loopback server and renderer are still
separate trust boundaries. The security posture is defense in depth: bind locally, authenticate
every API route, validate inputs again at the privileged boundary, and never expose general Node or
Electron capabilities to the renderer.

## Loopback server

- The listener binds `127.0.0.1`, not all interfaces.
- A Host-header guard accepts only the configured `127.0.0.1:<port>` origin, limiting DNS-rebinding
  attacks.
- `/auth/*` is public because it establishes the session. Every `/api/*` request passes `csrf()`,
  `authMiddleware`, and `requireUser` before core or contributed routers run.
- Browser callers use the encrypted, HTTP-only, same-site session cookie. Internal MCP callers use
  the per-app-run `INTERNAL_TOKEN`; the token maps to the machine user but carries no GitHub token.
- The WebSocket upgrade rechecks Host, Origin, and either the session cookie or internal token.

## Public automation API

The optional [public automation API](./public-api.md) is a **separate loopback listener** (its own
port, `127.0.0.1`-only, Host-guarded before Hono) so its port is independent of the SPA origin. It is
**disabled by default** and exposes nothing until a token is minted.

- Every route and the WebSocket upgrade require a **bearer token**; the public app rejects cookie and
  internal-token auth. Tokens are stored only as `SHA-256(secret)`, shown once, and revocable with
  immediate effect (next HTTP call `401`; live sockets closed).
- Two scopes only: `read` and `read + write`. **A `write` token can run arbitrary commands, edit
  files, and mutate Git/GitHub as the local user** — the Settings page states this explicitly, and it
  is the single highest-impact capability in the app. Loopback-only bind, show-once random secret, no
  request-body/command logging, and immediate revocation are the mitigations.
- Token issuance is a cookie-authenticated interactive ceremony; a bearer cannot mint bearers. The
  GitHub credential a bearer needs is stored encrypted in `oauth_accounts` (never returned).

## Renderer and Electron

The window uses context isolation and a sandboxed preload; raw `ipcRenderer` is never exposed.
Normal data and commands use authenticated HTTP, and streams use the authenticated WebSocket.
Preload IPC is reserved for native capabilities: close/quit lifecycle, the folder picker, and the
main-owned preview `WebContentsView`.

Unexpected navigation and window creation are blocked or opened externally by the main process.
Preview navigation is restricted to `http(s)`, and its `webContents` identifier never crosses to the
renderer. Browser automation binds inside main and is exposed to agents through permission-checked
tools.

## Secrets and sessions

- GitHub access tokens stay inside the encrypted session cookie and server bindings; public user
  responses never include them.
- Integration credentials are encrypted at rest with `SESSION_ENC_KEY` and are never returned to
  the renderer after submission.
- Electron stores `SESSION_ENC_KEY` through `safeStorage`. An explicit environment value wins and
  can recover or migrate an existing identity. Decryption failure is fatal rather than silently
  minting a replacement that would strand sessions and provider tokens.
- Child processes receive a controlled environment. GitHub and session secrets are not inherited;
  task identity and the short-lived internal API token are injected explicitly.

## External occurrence data (Rollbar)

Rollbar occurrence payloads can carry secrets and personal data even when an SDK scrubbed common
keys, so Acorn applies its **own** allowlist in `plugins/rollbar/server/normalize.ts` before anything
is persisted or rendered. Only a fixed set of normalized fields survive — exception class/message,
stack frames with bounded code context, request method+URL, application context, code version,
platform/language/framework, server host/branch, notifier name/version, and a minimal person id/
username/email. Everything else is dropped at the boundary: raw request headers, cookies, query
values, request/response bodies, user IP, locals/arguments, arbitrary `custom`/`extra`, telemetry,
and raw crash reports. There is no generic JSON viewer. Every string is control-char-stripped and
byte-capped; traces, frames, and total detail size are bounded so the normalized detail stays well
below the 256 KB cache ceiling, and `truncated: true` surfaces when a cap fired. Email is the most
sensitive field and is dropped first under size pressure. Raw occurrence JSON is never cached, logged,
or sent to the renderer; tests use synthetic fixtures only.

## Filesystem, processes, and database

Task-scoped file operations re-derive the worktree root from `taskId`, reject traversal and symlink
escapes, and validate request bodies before reaching main-process bridges. Process-spawning routes
validate their inputs and use the task worktree as the capability boundary.

The Postgres pane never persists connection URLs. Generated DML parameterizes values and validates
identifiers against the live schema before quoting them; the SQL editor intentionally executes the
user's verbatim SQL against the user's development database.

## Agent tools and workflows

Every agent tool declares a risk (`read`, `write`, or `execute`). Global tier/per-tool permissions
filter both discovery and direct calls. Workflow and profile ceilings can only narrow that set, never
widen it. Agent memory writes create human-gated proposals; they cannot silently modify accepted
memory.

## Repo-authored configuration

Committed `.acorn/config.toml` and `.acorn/workflows/*.toml` are remote-authored executable input.
Before a repo-owned run target or workflow can start, acorn hashes the verbatim repo configuration
snapshot and requires an explicit review. A machine-scoped `config_acks` row records the repo and
hash; a changed snapshot shows a diff and requires a new acknowledgement. User-level and database
fallback configuration remain usable while the repo layer is untrusted. Agent-triggered attempts
fail immediately with the stable `needs-trust` code and add a “Review & trust” notification; they
are never silently resumed after approval.

Security-relevant source: `core/main/server.ts`, `core/main/preload.ts`,
`core/main/sessionKeyStore.ts`, `core/main/repoConfigTrust.ts`, `core/server/index.ts`,
`core/server/middleware/`, `core/server/agentTools/`, feature route validators under
`plugins/*/server/routes/`, and the public API under `core/{server,main}/publicApi/`.
