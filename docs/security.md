# Security model

acorn is a local, single-user Electron application, but the renderer and the node are separate trust
boundaries — and, since the renderer moved to its own `app://acorn` origin, separate origins too. The
security posture is defense in depth: bind locally, authenticate every route, validate inputs again
at the privileged boundary, and never expose general Node or Electron capabilities to the renderer.

## Loopback server

- The listener binds `127.0.0.1`, not all interfaces, on an **ephemeral** port, and speaks **TLS 1.3
  only**. The self-signed certificate is minted into `<data root>/tls`; the client pins its sha256
  fingerprint at pairing and a fingerprint change is a hard stop.
- A Host-header guard accepts only the `127.0.0.1:<bound port>` origin, limiting DNS-rebinding
  attacks. Before the kernel has assigned the port there is no allowed Host, so the guard rejects
  everything — the safe direction for that sliver of time.
- The node serves **no web assets and has no SPA fallback**: there is no browser origin on it to
  defend, and nothing invites a page to treat it as one. Unmatched paths get a plain `404`.
- Every `/v2/*` request passes `authMiddleware` (resolve the principal) then `requireUser` (enforce
  it) before any core or plugin router runs. The two pairing routes — `GET /v2/node` and
  `POST /v2/pair` — sit above that gate by construction: a client that has never paired holds no
  credential, so they are the way in. They are public, not unprotected, and everything that
  *administers* devices stays under `/v2/core/devices`, below the gate.
- There is **no CSRF middleware, and its absence is deliberate**. CSRF defends *ambient* credentials
  — a cookie a browser attaches whether or not the page meant to send it — and no ambient credential
  is left. Every request carries a bearer held in Electron main, nothing a cross-site page can do
  makes anything attach it, and the renderer cannot open a socket to a node at all (below).
- The HTTP-client router is **device-principal-only**: internal MCP/agent callers cannot read
  encrypted request material, resolve variables, or use the outbound sender as a secret oracle.
- The WebSocket upgrade (`/v2/events`) rechecks Host and either a device bearer or the internal
  token, and it holds the device service so a revoked device's sockets close immediately.

## Principals

There are exactly two principals, and `Principal` — `{ kind: 'device' | 'internal'; userId;
deviceId? }` — is the whole of what a route may know about who is asking. `ownerId(c)` returns the
owner's GitHub login, the scope key for every user-scoped table.

- **`device`** — a paired client's bearer token, `acorn_dt_<uuid>_<base64url32>`. Stored only as
  `SHA-256(secret)`, returned exactly once at pairing, revocable with immediate effect (next HTTP
  call `401`; live sockets closed, and streams re-check within 60s). Every paired device has **full
  owner authority**: single-owner software has no roles or scopes, and pairing discloses that.
  Pairing is a short-lived single-use code with a bounded attempt budget and a rate ceiling, and its
  failures are uniform — there is no oracle for "right code, wrong something".
- **`internal`** — a child process this node spawned (the MCP server, command-variable executions,
  headless workflow steps). It presents the persisted mode-`0600` `INTERNAL_TOKEN` in the
  `x-acorn-internal` header and resolves to the machine's explicitly bound active identity, failing
  closed when nothing is bound rather than guessing from a first prefs/repo row.

A presented bearer that fails is a rejection, not an invitation to fall through to the internal
token. There is no session state on the node at all: a credential is presented per request.

The renderer holds **no credential of its own**. Electron main's connection broker owns each node's
endpoint, pinned certificate and device token, keeps the token in `safeStorage`, and is the only
thing that speaks to a node.

**The internal principal can reach GitHub.** The GitHub credential lives in an encrypted
`integrations` row read through `githubToken(c)`, which resolves it for `ownerId(c)` — the same owner
for either principal kind — and nothing in the github plugin's routers gates on kind. So an
agent-spawned child *can* spend the owner's GitHub credential; it is no longer structurally unable
to. That is a deliberate consequence of moving the credential off the principal, recorded in
[vNext/phase1-notes.md](./vNext/phase1-notes.md). The kind gates that do exist are the agent-tool
projections (renderer ⇒ `device`, MCP ⇒ `internal`) and the HTTP client's `send` (⇒ `device`).

## Renderer, node process, and Electron

The window uses context isolation and a sandboxed preload; raw `ipcRenderer` is never exposed. The
renderer loads from `app://acorn`, served by Electron main from the bundled client, under a
Content-Security-Policy set as a response header whose `connect-src` is `'self'` — so it has **no
network permission at all**. Every byte to or from a node, request/response and stream alike, crosses
preload IPC to the broker in main, which holds the pinned certificate and the device token. A
cross-site page cannot reach a node, and a compromised renderer cannot open a socket to anywhere.
Preload also carries the native capabilities: close/quit lifecycle, the folder picker, fleet
administration requests, and the main-owned preview `WebContentsView`.

The privileged Node/domain runtime is isolated from Electron main in a supervised **spawned Node
child process** (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`), not an Electron `utilityProcess`
— which is what lets the same service run without Electron at all. Its dependency graph is required
to remain Electron-free, while main is forbidden from importing service-owned engines. The
bidirectional protocol is versioned and Zod-validated at both endpoints; pending calls have timeouts
and reject when the peer closes. Service-to-main capabilities accept serializable, task-addressed
inputs only. Database handles, process objects, and `webContents` identifiers never cross this
boundary. Main exposes only native preview/browser adapters and owns restart/fail-closed policy; the
service owns filesystem/process/database operations and graceful resource draining.

Unexpected navigation and window creation are blocked or opened externally by the main process.
Anything handed to the OS via `shell.openExternal` passes a scheme allowlist first (`http`, `https`,
`mailto` — `@acorn/node-core/main/urlGuards.ts`): pane content includes third-party text we do not author, so an
anchor's `href` is untrusted, and `openExternal` resolves schemes through the OS launcher where
`file:` and custom schemes reach local bundles and other installed apps. Preview navigation is
restricted to `http(s)`, and its `webContents` identifier never crosses to the renderer. Browser
automation binds inside main and is exposed to agents through permission-checked tools.

## Secrets

- The GitHub access token is an integration credential like any other: one encrypted `integrations`
  row per owner, read only through `githubToken(c)`. It never reaches the renderer, and public
  responses never include it.
- Integration credentials are encrypted at rest with `SESSION_ENC_KEY` and are never returned to
  the renderer after submission.
- GitHub connects by the OAuth **device authorization grant**, so there is no client secret in the
  exchange, no redirect URI, and no callback URL to register. `GITHUB_CLIENT_ID` is required to boot
  a node; `GITHUB_CLIENT_SECRET` is still declared but read optionally and consumed by nothing.
- Electron stores `SESSION_ENC_KEY` through `safeStorage`. An explicit environment value wins and
  can recover or migrate an existing identity. Decryption failure is fatal rather than silently
  minting a replacement that would strand provider tokens.
- Child processes receive a controlled environment. GitHub credentials are not inherited; the node's
  endpoint, its TLS certificate path, task identity, and the persistent mode-`0600` internal API
  token are injected explicitly.
- The data root and blob/worktree directories are created mode `0700` and hold an exclusive process
  lock; SQLite, WAL/SHM, blob files, the TLS key/cert, `internal-token`, `node.json`, and
  `active-identity` are normalized to mode `0600`.
- HTTP-client request fields and all variable values are encrypted under `SESSION_ENC_KEY`. Only the
  device principal may open/send them; internal agent principals are rejected.

## External occurrence data (Rollbar)

Rollbar occurrence payloads can carry secrets and personal data even when an SDK scrubbed common
keys, so Acorn applies its **own** allowlist in `plugins/rollbar/src/server/normalize.ts` before
anything is persisted or rendered. Only a fixed set of normalized fields survive — exception class/message,
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
escapes, and validate request bodies before reaching the service bridges. Process-spawning routes
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
Before a repo-owned run target, workflow, or `[database].url_script` can run, acorn hashes the
verbatim repo configuration snapshot and requires an explicit review. A machine-scoped `config_acks` row records the repo and
hash; a changed snapshot shows a diff and requires a new acknowledgement. User-level and database
fallback configuration remain usable while the repo layer is untrusted — which is why each executable
field carries provenance (`repoTargetIds`, `dbUrlFromRepo` in `@acorn/node-core/main/runConfig.ts`) rather than
gating on the merged value, so a user-authored script is never penalised for a repo-authored one.
A tripped gate always fails closed: it must not degrade to a lower-precedence fallback, or the
refusal becomes invisible. Agent-triggered attempts
fail immediately with the stable `needs-trust` code and add a “Review & trust” notification; they
are never silently resumed after approval.

The declarative Docker `[docker]` table contains only project names, label keys, and a boolean name
matcher. It is not executable and therefore does not require this trust ceremony; Docker-start
commands remain ordinary trust-gated run targets.

Security-relevant source:
`apps/desktop/src/app/main/{serviceHost,desktopCapabilities,appScheme,nodeBroker,preload,sessionKeyStore}.ts`,
`apps/node/src/service/runtime.ts`,
`@acorn/protocol/{serviceProtocol,desktopCapabilities}.ts`,
`@acorn/node-core/main/{server,tls,dataRoot,bindings}.ts`,
`@acorn/node-core/main/repoConfigTrust.ts`, `@acorn/node-core/main/urlGuards.ts`,
`@acorn/node-core/main/pathGuards.ts`, `@acorn/node-core/server/index.ts`,
`@acorn/node-core/server/{middleware,auth}/`, `@acorn/node-core/server/agentTools/`,
`plugins/github/src/server/{githubToken.ts,routes/deviceAuth.ts}`, and feature route validators under
`plugins/*/src/server/routes/`.
