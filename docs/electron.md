# Electron runtime and migration record

> Status: **Migration complete**, and the transport it landed has since been **replaced** by vNext
> Phase 1. Read the banner below before trusting any transport detail in this file.
>
> Phases 0–2 done (Node-server spike + Electron shell + Cloudflare
> cut) plus the Phase 3 caching cleanup. The Hono app runs under `@hono/node-server`
> with a better-sqlite3-backed Bindings object (typed stores — the KV shim
> is gone), wrapped in an Electron app. A supervised Node child process owns the
> server, SQLite, PTYs, Git/process work, and background reconciliation; Electron main owns
> native windows/views/dialogs, lifecycle supervision, and the connection broker.
> **Cloudflare/wrangler is fully removed** — Electron is the shipped product runtime; `dev:node`
> remains a supported development composition root for pure-Node server capabilities. The **v2
> terminal (§8) has since shipped**: node-pty
> sessions run in the utility service (`plugins/terminal/src/main/terminal.ts`, desktop-only and always on — see
> [terminal-and-agents.md](./terminal-and-agents.md)). `SESSION_ENC_KEY` now uses `safeStorage`;
> **GitHub device flow shipped** in vNext Phase 1, so nothing reads `client_secret` any more.
> This doc is the full change inventory and the record of a clean, phased
> transition off Cloudflare Workers to a local Electron app — read it for the *why* behind the
> current runtime shape; [architecture-overview.md](./architecture-overview.md) describes what
> exists today.
>
> Companion doc: [terminal-and-agents.md](./terminal-and-agents.md) — the terminal/agent-session
> feature originally collapsed into Electron main as §8 predicted and now runs in the supervised
> utility service. (Its design record, `vNext.md`, is now removed — see git history.)
>
> ### What vNext Phase 1 changed underneath this record
>
> Five things in this document are now false wherever they appear, and they are the load-bearing ones:
>
> 1. **The port is not pinned and the scheme is not http.** The node listens over **HTTPS with
>    `minVersion: 'TLSv1.3'` on an ephemeral port**, with a self-signed certificate the client pins by
>    fingerprint. `service.start` reports `{ nodeId, endpoint, deviceToken, fingerprint, certPem }`
>    back to main. `ACORN_PORT` still forces a port; there is no default. See §9.1.
> 2. **The renderer is not served by the node and does not share its origin.** It loads from
>    `app://acorn`, served by Electron main's protocol handler (`main/appScheme.ts`). The node serves
>    no web assets at all — §4e is history, not current behaviour.
> 3. **There is no session cookie, no `/auth/*` and no login.** Auth is a device-token bearer held by
>    Electron main; §4f is superseded in full by [authentication.md](./authentication.md).
> 4. **All node traffic goes through a connection broker in Electron main** — request/response *and*
>    streams both ride preload IPC now. §4g and §12 are updated below; the rest of this file's
>    "same-origin fetch" phrasing is historical.
> 5. **`utilityProcess.fork` is gone.** The node is spawned as an ordinary Node child process with
>    `ELECTRON_RUN_AS_NODE=1` and an IPC channel, so the boot handshake is reachable from a plain-Node
>    test and anything that can spawn a Node process can start a node.
>
> Routes are `/v2/core/*` + `/v2/p/<plugin>/*`; the WebSocket is `/v2/events`; the database is
> `core.sqlite` under `apps/node/.acorn/` in a checkout. See
> [vNext/phase1-notes.md](./vNext/phase1-notes.md).
>
> **Phase 0 artifacts:** `packages/node-core/src/main/bindings.ts` (DB + `.batch` shim,
> on-disk `BLOBS`, secrets from `process.env`), `packages/node-core/src/main/server.ts` (node-server bootstrap
> + TLS + listener), `createApp()` factory in `packages/node-core/src/server/index.ts`, DB driver swap in
> `packages/node-core/src/server/db/index.ts`. Run with `pnpm dev:node`. Local data lives under
> `apps/node/.acorn/` (gitignored).
>
> **Phase 1 artifacts** (the Electron-migration Phase 1, not vNext's): `apps/desktop/src/app/main/electron.ts`
> (main process: starts the node, hardened BrowserWindow, navigation guard),
> `apps/desktop/src/app/main/preload.ts` (minimal sandboxed bridge),
> `electron.vite.config.ts` (main/preload/renderer→dist/client), loopback Host-header guard in
> `server.ts`. **`pnpm dev` launches the Electron app** (`build:service && electron-vite build &&
> check:runtime-syntax && electron-vite preview`; old Cloudflare dev server → `dev:web`), plus
> `electron:dev` and `electron:rebuild` / root `rebuild:node` (native-module ABI switch — see caveat in
> §4i; the interim `electron:build` script was folded into `build`/`dist` in Phase 2). The window
> loads `app://acorn`, never electron-vite's renderer dev server and never a node's origin. The
> dedicated OAuth `BrowserWindow` this phase added has since been deleted — GitHub connects by device
> flow, so no window of ours visits github.com.

## 1. Why Electron (decision recap)

acorn is committed to **local-only**. The Worker runtime is the wrong host for that: it has no
process model (can't spawn `claude`, hold a PTY, or touch the filesystem), and we don't need the
edge. The codebase is **100% TypeScript with a Node-shaped backend** (Hono + Drizzle + `jose`),
so Electron — where the main process *is* Node — has near-zero language impedance. Tauri would
force us to ship the backend as a Node sidecar anyway, buying Rust+IPC complexity for no real win.

The good news, established by reading every binding usage (§3): **the port is small and
contained.** Hono is runtime-agnostic, Drizzle abstracts the DB, and the two KV uses are trivial
to replace. The whole "one server serves `/api` + `/auth` + the SPA" model is *preserved* — only
the runtime under it changes.

## 2. Target architecture

```
┌──────────────────────── Electron app ────────────────────────┐
│                                                               │
│  main process: BrowserWindow/WebContentsView/dialog + supervisor│
│       │ typed task-addressed capability RPC                    │
│       ▼                                                        │
│  Node utility process                                         │
│   ├─ Bindings: SQLite/Drizzle, caches, secrets                 │
│   ├─ @hono/node-server on http://127.0.0.1:<port>              │
│   │     └─ the SAME Hono app: /auth, /api/*, + static SPA     │
│   └─ node-pty, Git/process work, workflows, reconciliation     │
│                                                                │
│  BrowserWindow.loadURL('http://127.0.0.1:<port>')             │
│                                                  │             │
│  renderer (Chromium)  ── SolidJS UI + SW gate ────────────────┘
│        talks to /api same-origin; cookies work as today       │
└───────────────────────────────────────────────────────────────┘
```

> **Superseded by vNext Phase 1 — and this section is worth reading precisely because it lost.** Both
> key choices below were reversed: the node serves no web assets and the renderer loads
> `app://acorn`, and there is no pinned port. The reasoning here was sound *given a session cookie* —
> a single HTTP origin is what made the cookie, CSRF and the OAuth callback work unchanged, and a
> pinned port is what kept IndexedDB stable. Removing the cookie removed the premise: with a bearer
> held by Electron main there is nothing ambient to keep same-origin for, `app://acorn` is a *more*
> stable storage origin than any port, and both "we do not load file://" and "we do not invent an IPC
> API for data" stopped applying — the data API is now IPC, deliberately, because that is where the
> pinned certificate and the token live. See §12.

Key choice: **the Node server serves both the API and the built SPA** (with SPA fallback), and the
window `loadURL`s `http://127.0.0.1:<port>`. This keeps a single HTTP origin → the existing session
cookie, CSRF, and OAuth-callback flow all keep working unchanged. We do **not** load `file://`
(that breaks cookies and same-origin) and we do **not** invent an IPC API for data (the HTTP API
already exists).

Prefer a **stable loopback origin** (`127.0.0.1` + one pinned port) even though GitHub loopback
OAuth can technically use a dynamic port. The app's IndexedDB query cache,
Chromium permissions, and renderer storage are origin-scoped; a new port every launch gives the
user a fresh browser profile for those features. Pick a high, uncommon port, enforce single-instance
startup, and fail with a clear error if another process owns it.

## 3. Cloudflare blast radius (what actually touches Workers)

Exhaustive — this is everything that isn't portable as-is:

| Touchpoint | Where | Replacement |
|---|---|---|
| D1 client | `packages/node-core/src/server/db/index.ts:1,5` (`drizzle-orm/d1`, `env.DB`) | `drizzle-orm/better-sqlite3` |
| Migrations apply | `package.json` `db:migrate` (`wrangler d1 migrations apply`) | `drizzle-orm/better-sqlite3/migrator` on startup |
| KV `OAUTH_STATE` | `routes/auth.ts:41,77,78` (put TTL / get / delete) | in-memory `Map` with expiry |
| KV `BLOBS` | `routes/pullBlob.ts:33,43`, `routes/prMirror.ts:309,360` | on-disk cache dir keyed by sha |
| `waitUntil` | `routes/repoMirror.ts:27-28`, called from `pulls/repos/pullDetail/pullFiles` via `c.executionCtx` | fire-and-forget in Node (one helper) |
| Secrets / vars | `SESSION_ENC_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` via `c.env` + `.dev.vars` | `.env` / OS keychain → injected into Bindings |
| Worker entry | `packages/node-core/src/server/index.ts:44` (`export default app`) | `@hono/node-server` `serve(app)` |
| Static + SPA fallback | `wrangler.jsonc` `assets` block | `serveStatic` + index.html fallback in the Hono app |
| PWA shell | `src/app/client/index.tsx`, `public/sw.js`, `manifest.webmanifest` | removed — the service worker and web manifest are gone; the renderer only unregisters any leftover web-origin service worker (§4h) |
| Build plugin | `vite.config.ts` `@cloudflare/vite-plugin` | `electron-vite` (main/preload/renderer) |
| Env types | `worker-configuration.d.ts` (`Env`), `typegen` script | hand-written `Bindings` type |

**Confirmed *not* present in the Worker/server runtime** (so nothing to port): no Durable Objects,
no Cloudflare `caches.default` / server-side `caches.*`, no `scheduled`/cron, no `env.ASSETS`
fetch, no R2. Globals already in Node: `fetch`, `crypto.randomUUID`, `atob`, `TextDecoder/Encoder`.
`jose`, `hono/csrf`, `hono/cookie` are all runtime-agnostic.

That's the entire list. Everything else — all 16 route modules' business logic, the Drizzle schema,
the migration SQL, the GitHub client, and the SolidJS product UI — is untouched. The only renderer
change called out below is removing the service worker (§4h).

## 4. The initial migration changes

> This section records the Phase 0–2 landing from Workers into a Node server hosted directly by
> Electron main. Its code sketches and “add” language are historical. The shipped runtime later
> moved that Node application intact into the supervised utility process described in §2, §11, and
> §12.

### 4a. Runtime entry — Worker → node-server in Electron main (historical)

`packages/node-core/src/server/index.ts` keeps building the same route graph, but exposes it as a factory so the Node
bootstrap can add desktop-only static serving without mutating the singleton used by tests:

```ts
export function createApp() {
  return new Hono<AppEnv>()
    .route('/auth', auth)
    .use('/api/*', csrf())
    .use('/api/*', authMiddleware)
    // ...the existing route chain
}

export default createApp()
```

Add a Node bootstrap (new file, e.g. `packages/node-core/src/main/server.ts`) that supplies runtime bindings through
`app.fetch(request, env, executionCtx)`. Do **not** set `c.env` in a late middleware: middleware
ordering is too easy to get wrong, and `@hono/node-server` also uses `c.env` for its Node HTTP
bindings.

```ts
import { serve, type HttpBindings } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from '../server/index'
import { makeBindings, type RuntimeBindings } from './bindings' // §4b

type NodeEnv = RuntimeBindings & Partial<HttpBindings>

export async function startServer() {
  const runtime = await makeBindings()
  const app = createApp()

  // Use an absolute packaged path, not process.cwd().
  app.use('/*', serveStatic({ root: clientDistDir }))
  app.notFound((c) => {
    const path = new URL(c.req.url).pathname
    if (path.startsWith('/api/') || path.startsWith('/auth/')) return c.text('Not found', 404)
    return c.html(indexHtml)
  })

  const fetch = (
    request: Request,
    nodeEnv: HttpBindings,
    executionCtx?: Parameters<typeof app.fetch>[2],
  ) =>
    app.fetch(request, { ...nodeEnv, ...runtime } satisfies NodeEnv, executionCtx)

  return serve({ fetch, hostname: '127.0.0.1', port: ACORN_PORT })
}
```

Electron `main.ts`:

```ts
import { app as electron, BrowserWindow } from 'electron'
import { startServer } from './server'
electron.whenReady().then(async () => {
  const server = await startServer()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('local server did not bind to TCP')
  const win = new BrowserWindow({
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.loadURL(`http://127.0.0.1:${address.port}`)
})
```

Port policy: use a pinned port for a stable app origin. GitHub's loopback redirect handling does
not require the runtime port to match the registered callback port, so OAuth is not the reason to
pin it; IndexedDB continuity is.

### 4b. The Bindings shim (replaces `Env`)

One module constructs the object the routes already expect via `c.env`. The hand-written global
`Env` replaces the deleted `worker-configuration.d.ts` and extends the current runtime bindings
with optional `@hono/node-server` HTTP bindings:

```ts
export type RuntimeBindings = {
  DB: AppDatabase
  OAUTH_STATE: OauthStateStore           // issue/consume; five-minute in-memory TTL
  BLOBS: BlobCache
  SESSION_ENC_KEY: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  INTERNAL_TOKEN: string
  ACTIVE_IDENTITY: ActiveIdentityStore
}
```

- **`OAUTH_STATE`** — 5-minute ephemeral CSRF state with atomic issue/consume semantics; no
  persistence wanted.
- **`BLOBS`** — immutable blob/patch bodies keyed by sha for public and private repos. Back it with a cache dir
  (`app.getPath('userData')/blobs/<sha>`), `.get` = read file, `.put` = write file. ~20 lines.
- **secrets** — read from `.env` in dev. `SESSION_ENC_KEY` falls through to Electron `safeStorage`
  in a packaged build (Phase 9 C, `sessionKeyStore.ts`): env always wins and is persisted as the
  env-only migration path; otherwise a fresh data root mints once. An existing database with
  neither source fails closed instead of changing identity. GitHub OAuth credentials resolve from
  the data-root `.env`, process environment, then the `MAIN_VITE_GITHUB_CLIENT_*` build fallback.
  Release CI uses that fallback so the package is self-contained. `SESSION_ENC_KEY` is never baked;
  the current OAuth client secret is, and must be treated as recoverable from a distributed binary.

`INTERNAL_TOKEN` is private persisted bearer material for loopback callers that hold no session
cookie (the acorn MCP server — agents inherit it as `ACORN_API_TOKEN`; auth maps it through the
explicit active-identity binding). `API_TOKENS`, `OAUTH_ACCOUNTS`, and `UI_BROKER` are shared by the
internal administration routes and optional public listener. The migration sketch's `KVish` was
retired for plain typed modules that say what they mean:
`OauthStateStore { issue(state), consume(state) }` (in-memory, TTL internal) and
`BlobCache { get(key), put(key, value) }` (on-disk by sha; immutable content, so no TTL and no
delete). The global `Env` in `src/env.d.ts` extends `RuntimeBindings` **and**
`Partial<HttpBindings>` so `main/server.ts` builds the env at
the `app.fetch()` seam without a cast.

### 4c. DB driver swap

`packages/node-core/src/server/db/index.ts` is the *only* DB-runtime file, but the swap is **not** two lines — see the
`.batch()` caveat below. `getDb` now just hands back the instance built once at bootstrap:

```ts
// db/index.ts — type-only better-sqlite3 import keeps the native module out of the worker bundle
import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>
}
// Runtime-agnostic so BOTH dev paths work in parallel through Phase 1: Node injects a ready-built
// better-sqlite3 client (has query methods); Workers inject a raw D1 namespace that needs wrapping.
export const getDb = (env: Env): AppDatabase => {
  const db = env.DB as unknown
  if (db && typeof (db as { select?: unknown }).select === 'function') return db as AppDatabase
  return drizzleD1(env.DB, { schema }) as unknown as AppDatabase
}
// bindings.ts (Node): const DB = drizzle(new Database(dbPath), { schema }); migrate(DB, ...)
```

> **Reversibility caveat (learned the hard way):** an early version made `getDb` return `env.DB`
> directly, which broke the Workers `pnpm dev` path (`db.select is not a function`) because there
> `env.DB` is a raw D1 namespace. Keep `getDb` dual-runtime until Cloudflare is deleted in Phase 2.

- **`.batch()` is the real gotcha (not in the original plan).** Routes use `db.batch([...])` in 5
  places (`repoMirror.ts`, `prMirror.ts` ×2, `prActions.ts` ×2). That method exists only on D1/libsql
  — `better-sqlite3`'s drizzle (`BaseSQLiteDatabase`) has `transaction()` but **no `batch`**. Rather
  than edit 5 route call sites, `bindings.ts` attaches an emulated `batch` that runs the statements
  inside a synchronous `db.transaction(...)` (same all-or-nothing semantics). Verified with an
  atomicity check (commit-all + rollback-on-PK-collision). The `AppDatabase` type above carries the
  method so the call sites typecheck unchanged.

- Migration SQL is **already SQLite dialect** (D1 is SQLite) — `migrations/` is reused verbatim.
- Replace `wrangler d1 migrations apply` with a startup runner:
  `migrate(db, { migrationsFolder })` from `drizzle-orm/better-sqlite3/migrator`.
- `drizzle-kit generate` stays (dialect is `sqlite` either way; just point `drizzle.config` at the
  better-sqlite3 driver).
- Store the writable database under `electron.app.getPath('userData')`, e.g.
  `<userData>/acorn.sqlite`. Do not put it under the app bundle or `resources`; those paths are
  read-only after packaging.
  *As shipped:* `main/electron.ts` resolves the data root once — `app.getPath('userData')` when
  `app.isPackaged`, else the repo-local `apps/node/.acorn/` (so a dev checkout's data stays with
  the checkout) — and passes it into `bootstrap({ dataDir })`; the standalone entry takes
  `ACORN_DATA_DIR` or that same dev root. The file is `core.sqlite`, and `openDataRoot` refuses a
  directory holding V1's `acorn.sqlite` outright.
- Open SQLite with the desktop pragmas explicitly: `journal_mode = WAL` and a short
  `busy_timeout`. (`foreign_keys = ON` was deliberately dropped — the schema declares no FK
  constraints, so the pragma was a misleading no-op; see docs/data-layer.md.)
- Package migrations as readable resources (`extraResources` or an import-time manifest) and resolve
  `migrationsFolder` from `process.resourcesPath` / `import.meta.url`, never from `process.cwd()`.
- **Native-module rebuild (decided approach):** `better-sqlite3` must be rebuilt against Electron's
  ABI via `@electron/rebuild`. Wire it into a `postinstall` script in Phase 1 so it's automatic and
  CI-safe; this same setup covers `node-pty` for v2 (§8) — solve once. (Fallback only if it ever
  bites: `@libsql/client` prebuilds with `drizzle-orm/libsql`.)
  *What shipped differs:* the rebuild stayed **manual** (`electron:rebuild` / root `rebuild:node`, both
  now covering `better-sqlite3` *and* `node-pty`) because the plain-Node paths (`dev:node`,
  `db:migrate`) outlived Phase 2 and need the Node ABI — a `postinstall` pinning the Electron ABI
  would silently break them. The two-script switch is the accepted trade-off.

### 4d. `waitUntil` shim

*(Historical — the helper has since been renamed `trackBackgroundRefresh` and moved to
`packages/node-core/src/server/background.ts`.)*

`repoMirror.ts` already centralizes this in one helper (`waitUntilLogged`). In Workers,
`ctx.waitUntil` keeps the isolate alive past the response; in Node the process stays alive anyway,
so background work just runs. Change the one helper to ignore the ctx and fire-and-forget:

```ts
export const waitUntilLogged = (_ctx: unknown, label: string, p: Promise<unknown>) => {
  void p.catch((e) => console.error(`${label} background refresh failed`, e))
}
```

Callers (`pulls.ts`, `repos.ts`, `pullDetail.ts`, `pullFiles.ts`) pass `c.executionCtx` — leave
them; the helper just stops using it. (Optionally drop the arg later for cleanliness.)

**What Phase 0 actually did:** the helper was left fully unchanged. Hono's `c.executionCtx` getter
*throws* when no context is supplied, and the callers still read it — so the Node bootstrap passed a
no-op stub `{ waitUntil(){}, passThroughOnException(){} }` as the third arg to `app.fetch`. With a
no-op `waitUntil`, the background promise still runs to completion in the long-lived Node process and
its `.catch` still logs.

**Since cleaned up (post-Phase 2):** the ctx arg was dropped entirely — the helper (now
`trackBackgroundRefresh(label, promise)` in `packages/node-core/src/server/background.ts`) is a plain fire-and-forget
with error logging, the callers no longer read `c.executionCtx`, and `server.ts` passes no
execution-context stub. The Workers-era `waitUntilLogged` name is gone too.

### 4e. Static assets + SPA fallback

> **Superseded.** The node serves no web assets and has no SPA fallback: an unmatched path gets
> Hono's plain 404. The renderer's bytes are served by Electron main's `app://acorn` protocol handler
> (`main/appScheme.ts`), which is simpler than what this section describes precisely because under
> `app://` there are no API paths to exclude — the API is IPC. Kept as the record of why the fallback
> had to exclude `/api/*` and `/auth/*` while it existed.

`wrangler.jsonc`'s `assets` block did two declarative things we now do in-app (shown in 4a):
serve `dist/client/*` and fall back unmatched SPA routes to `index.html`.

Be precise here: `run_worker_first` gave `/api/*` and `/auth/*` to the Worker even when no route
matched, so those paths should still return API/auth 404s, not the SPA shell. The fallback handler
must check the pathname and only serve `index.html` for non-API, non-auth navigation paths.

Use absolute paths for the renderer build in both dev and packaged modes. `serveStatic({ root:
'./dist/client' })` works from the repo root but breaks when the app is launched from Finder.

### 4f. OAuth in a desktop app

> **Superseded in full — and the "recommended follow-up" at the end of this section is what shipped.**
> vNext Phase 1 replaced the web flow with the GitHub **device authorization grant**
> (`plugins/github/src/server/routes/deviceAuth.ts`): no `client_secret`, no `redirect_uri`, no
> registered callback URL, and no OAuth `BrowserWindow`. The OAuth App needs "Enable Device Flow" on
> and nothing else. There is also no session cookie left to set in the wrong browser, because there
> is no session. Current behaviour: [authentication.md](./authentication.md). The one deliberate
> residue is that `GITHUB_CLIENT_SECRET` is still *declared* — read optionally, consumed by nothing —
> at the owner's request; `GITHUB_CLIENT_ID` is required. Everything below is the record of the
> reasoning that led there.

The web flow (`routes/auth.ts`, now deleted) worked **almost unchanged** because the renderer ran on
`http://127.0.0.1:<port>`:

- `redirect_uri` resolves to `http://127.0.0.1:<port>/auth/callback`. Register a loopback callback
  for the GitHub OAuth app. GitHub allows a loopback redirect URL to use a runtime port that differs
  from the registered callback port; we still prefer a pinned port for stable browser storage (§2).
- The session cookie is the non-secure `session` name over `http://` — so the sealed-cookie session
  works as-is; no auth rewrite required for v1. (The HTTPS `__Host-` branch and `cookieAttrs()` have
  since been deleted — `SESSION_COOKIE` in `session.ts` is the single cookie name.)
- Trigger `/auth/login` in a dedicated OAuth `BrowserWindow` that uses the same Electron session
  partition as the app, but has **no preload**, `nodeIntegration: false`, `contextIsolation: true`,
  and `sandbox: true`. Close it after `/auth/callback` completes and refresh `/api/me` in the main
  window.
- Do **not** use `shell.openExternal('/auth/login')` for the existing web flow: the system browser's
  cookie jar is not the Electron window's cookie jar, so the callback would set the session cookie
  in the wrong browser. Use the system browser only if/when we switch to device flow.

**The one real wrinkle — `client_secret` in a desktop app.** The web flow needs
`GITHUB_CLIENT_SECRET` to exchange the code, and a secret shipped in a distributed binary is
extractable.
- *Personal/local use (now):* keep the web flow; put your own OAuth app's secret in local config /
  keychain. It never leaves your machine. Acceptable for a tool you run yourself.
- *If ever distributed:* switch to GitHub **device flow** (no client secret — user enters a code).
  Device flow is the clean desktop-native end state and lets us **delete `GITHUB_CLIENT_SECRET`
  entirely**. Flagged as a recommended follow-up, not a v1 blocker.

### 4g. Electron security boundary

Electron adds a privileged boundary: renderer ↔ preload ↔ main. Treat that as a narrow capability
API, not a general bridge. As of vNext Phase 1 that boundary carries **all** node traffic, which
makes it the most security-relevant surface in the app rather than a side channel.

- Main app window: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and a preload
  that exposes only named methods. Never raw `ipcRenderer`.
- Navigation guard: the main app window may load only `app://acorn` (`APP_ORIGIN`). Everything else
  goes to the system browser through a scheme allowlist (`isAllowedExternalUrl`), because the content
  that produces those links — GitHub bodies, Linear issues, Rollbar — is third-party, so a
  `file:`/custom-scheme href would otherwise be an arbitrary-app launch. There is no OAuth exception
  any more.
- The renderer's own requests are Zod-parsed in main before the broker acts on them
  (`nodeBrokerIpc.ts`). In particular a `nodeFetch` `path` must start with `/`, which is what stops a
  request being aimed at a host other than the node: main joins it onto the node's endpoint with
  `new URL(path, endpoint)`. The renderer is our own code, but it is also the only part of the system
  that renders third-party content.
- **The renderer holds no credential.** No device token, no certificate, no GitHub token. Main owns
  the pinned `https.Agent` and attaches the bearer itself (`nodeBroker.ts`), and tokens live in
  `safeStorage` (`deviceTokenStore.ts`, `sessionKeyStore.ts`). Nothing in `NodeRecord` — the
  renderer's projection of a node — carries either.
- **The pin fails closed.** A certificate whose fingerprint does not match, including one signed by
  an unrelated key that merely *claims* the right fingerprint, is refused; the broker stops
  reconnecting and the UI surfaces `identity_mismatch` with **no retrust affordance**. There is
  deliberately no `app.on('certificate-error')` handler: that event only fires for requests Chromium
  makes, and nothing asks Chromium to talk to a node — adding one "just in case" would install a
  certificate-override path for a trust decision made somewhere else entirely.
- Node-side guard: bind only `127.0.0.1`, serve TLS 1.3 only, and reject any `Host` other than the
  `127.0.0.1:<bound port>` actually bound, before routing. Both the HTTP path and the WebSocket
  upgrade enforce it.
- Terminal request bodies are validated at the Hono boundary: session id, cwd, cols/rows,
  input bytes, and lifecycle commands. Native service↔main calls use the narrower versioned schemas
  in `@acorn/protocol/{serviceProtocol,desktopCapabilities}.ts`, and the renderer↔main node contract
  is `@acorn/protocol/broker.ts`.
- **CSP, set as a response header** by the `app://` handler — not an `index.html` meta tag, because a
  header cannot be overridden by markup injected into the document and a meta tag can be preceded by
  content it therefore fails to cover. The policy is `default-src 'self'` with four deliberate
  loosenings and one deliberate tightening:
  - `style-src 'unsafe-inline'` is **required**: Shiki emits `style="color:#…"` attributes into HTML
    that reaches `innerHTML`, and style *attributes* are CSP-gated. (Solid's `el.style.x = v` is not.)
  - `img-src https:` for GitHub avatars — a hardening candidate once nothing else renders a remote image.
  - `worker-src 'self' blob:` for Monaco's five `?worker` chunks.
  - `frame-src 'none'`: the preview pane is a main-owned `WebContentsView`, never an iframe.
  - **`connect-src 'self'`** — the tightening, and the one worth stating plainly. Because all node
    traffic is IPC, the renderer needs no network permission at all, so a compromised renderer cannot
    open a socket to a node, to GitHub, or anywhere else.
  Two e2e tests guard this from both directions: S1 asserts **zero console errors**, which is how a
  policy tightened past what the shell needs shows up (a violation is reported as a console error and
  nothing else); S8 reads the header back off the response, which is the only way to catch a policy
  that is missing entirely.
- Privileged scheme registration must run at module scope before `app.whenReady()` — Chromium reads
  the table while it initialises and registering later is a silent no-op. `app://` is registered
  `standard` (hierarchical URLs, which is what makes `base: '/'`, `history.pushState` and path routing
  work), `secure` (IndexedDB, `crypto.subtle`, clipboard), `supportFetchAPI`, `stream` and
  `codeCache` — deliberately **not** `corsEnabled` (nothing is cross-origin) and **not**
  `allowServiceWorkers` (no worker may cache the shell).

### 4h. PWA / service worker decision

The old web SPA registered `public/sw.js` unconditionally. In Electron the service worker is no
longer needed to make the app installable, and it can create confusing update bugs by serving an
old cached app shell after an app upgrade.

Resolved: the service worker (`public/sw.js`) and web manifest (`public/manifest.webmanifest`) have
been removed entirely, along with the `<link rel="manifest">`/`theme-color` tags in `index.html`.
The renderer boot in `src/app/client/index.tsx` now only unregisters any service worker left over from a
prior web (Cloudflare Workers) visit to this origin. The IndexedDB TanStack Query cache is kept — it
gives fast warm reads and offline browsing without a service worker (see [caching](./caching.md)).

### 4i. Build & packaging

- **`electron-vite`** replaces `@cloudflare/vite-plugin`. It builds three targets — `main`,
  `preload`, `renderer`. The renderer config is essentially today's `vite-plugin-solid` setup; the
  SolidJS app moves under it with no source changes.
- **`electron-builder`** (or forge) for packaging/installers + auto-update. **macOS-only** target
  (`dmg`/`zip`, arm64 + x64 or a universal build) — no Windows/Linux config to carry. For personal
  use, ad-hoc signing is fine; only set up a Developer ID cert + notarization if/when you distribute
  the `.dmg` to other machines (Gatekeeper will otherwise block it).
- Configure packaging for native modules and runtime resources:
  - `asarUnpack`: native `.node` modules used by `better-sqlite3` now and `node-pty` later.
  - `extraResources` or equivalent: Drizzle migration files if they are not bundled into JS.
  - `files`: renderer assets, main/preload output, and any static files still served by Hono.
- The shipped scripts are:

| Script | Current behavior |
|---|---|
| `dev` | `electron-vite build && electron-vite preview` |
| `build` | `electron-vite build` plus the renderer-size budget gate |
| `dist` | the gated build plus `electron-builder --mac` |
| `test:e2e` | build/rebuild for Electron and run Playwright smoke tests |
| `db:generate` | Drizzle generation plus a fresh-DB migration replay |
| `db:migrate` | `tsx scripts/migrate.ts` (also runs on startup) |

## 5. Cleanup — what to delete (clean transition matters)

Do this in **Phase 2**, *after* the Electron path is proven working, so we never have a half-broken
in-between (see §7). Then delete decisively:

**Files / config:**
- `apps/desktop/wrangler.jsonc`
- `apps/desktop/worker-configuration.d.ts` (replaced by hand-written `Bindings`)
- `apps/desktop/.dev.vars` → `.env` (update `.gitignore` note in CLAUDE.md)
- `.wrangler/` state dir
- `observability` config (Workers-only) — use Electron logging instead
- root `build-deploy` script and README production-deploy instructions
- PWA install metadata and the service worker (`manifest.webmanifest`, `sw.js`) — removed (§4h)

**Dependencies:**
- remove `wrangler`, `@cloudflare/vite-plugin`
- add `electron`, `electron-vite`, `electron-builder`, `@hono/node-server`, `better-sqlite3`
  (+ `@electron/rebuild`), `@types/better-sqlite3`, `dotenv` or equivalent `.env` loading

**Code simplifications (the satisfying part):**
- **Caching public/private split goes away. ✅ DONE (Phase 3 cleanup).** `pullBlob.ts` /
  `prMirror.ts` no longer special-case private repos: the `if (!repoRow.private)` guards are gone,
  all blob/patch bodies cache by sha in the local on-disk BLOBS dir, and `mirrorFiles` dropped its
  `isPrivate` param (patches live only in BLOBS now, never the DB `patch` column). Removed a class
  of subtle bugs. (Verified: lint + 88 tests + boot.)
- **Session cookie (optional, Phase 3).** The sealed-JWE-cookie + "token never reaches the browser"
  design exists to defend a shared-origin web app. In a single-user desktop app it's
  over-engineered — the token could live in the OS keychain and be injected server-side.
  *But* `SESSION_ENC_KEY` still earns its keep encrypting **integration tokens at rest**
  (`encryptSecret`/`decryptSecret`, e.g. Linear) in SQLite, so `session.ts` doesn't fully go away.
  Recommendation: keep the cookie for v1 (it works), simplify to keychain in Phase 3 only if the
  complexity becomes a real maintenance cost. Do not rewrite working auth during the runtime
  migration.

**Docs to update:** `CLAUDE.md` (architecture/commands/secrets sections), `docs/architecture-overview.md`,
`docs/caching.md`, `docs/authentication.md`, `docs/local-development.md`, `docs/api-reference.md`.

## 6. What stays unchanged (scope guard)

To keep the transition calm, note how much does **not** move:

- The SolidJS product UI (`packages/client-core/src/**`, `src/plugins/*/client/**`, `src/app/client/**`) —
  router, TanStack Query, IndexedDB persistence, Shiki,
  all panels. It just loads from `http://127.0.0.1:<port>` instead of the Worker. The exception is
  the boot-time service-worker unregister in `src/app/client/index.tsx` (§4h).
- All 16 route modules' business logic and the Hono routing in `index.ts` (now a `createApp()` factory).
- The Drizzle **schema** and all migration SQL.
- The GitHub client (`github/index.ts`) — plain `fetch`.
- The session crypto (`session.ts`) — `jose` runs in Node. (vNext Phase 1 deleted the session; `jose` survives in `server/secretBox.ts` for at-rest secrets.)
- **Tests** — they call `app.fetch(req, env, ctx)` with mocked `env`/`waitUntil`. The Hono app is
  unchanged and the mocked `env` shape is nearly identical to the new `Bindings`, so churn is
  minimal (drop the `ExecutionContext` mock once `waitUntilLogged` ignores it).

## 7. Phased migration (no broken in-between)

**Phase 0 — Node-server spike (de-risk, reversible). ✅ DONE.** The *existing* Hono app runs under
`@hono/node-server` serving API + SPA on `http://127.0.0.1:4317`, with the Bindings shim
(better-sqlite3 + `.batch` emulation, in-mem `OAUTH_STATE`, on-disk `BLOBS`). `wrangler`/Cloudflare
config is untouched and `pnpm build` still succeeds (reversible). Verified: `pnpm lint` + all 88
tests pass; SPA shell at `/`, `/api/me` → 401 (session crypto works in Node), SPA fallback for client
routes, `/api/*` 404s preserved, static assets served, SQLite migrated (WAL) under `apps/desktop/.acorn/`,
and the `.batch` shim is atomic. The riskiest step (DB driver, waitUntil, bindings) is behind us.

At the time this required registering `http://127.0.0.1:4317/auth/callback` as a loopback callback on
the GitHub OAuth app. **No longer:** the device flow needs no callback URL (§4f).

**Phase 1 — Electron shell. ✅ DONE.** Wrapped
Phase 0 in Electron (`electron-vite` + `src/app/main/electron.ts` + `packages/node-core/src/main/preload.ts`). The main
process starts the server then loads `http://127.0.0.1:4317`; navigation is locked to the loopback
origin, external links open in the system browser, and `/auth/login` is rerouted into a dedicated
sandboxed OAuth window. SW registration is gated out of the Electron renderer. `better-sqlite3` is
rebuilt against Electron's ABI via `pnpm electron:rebuild`. Verified headlessly that the app boots,
the server binds, the native module loads, the SPA serves, and the login redirect chain fires.

> **better-sqlite3 ABI caveat:** the native module can be built for the Node ABI *or* the Electron
> ABI, not both. `electron:rebuild` switches it to Electron (needed to run the app); the root
> `rebuild:node` switches it back for `dev:node`. This is why the rebuild is **not** a `postinstall` — that would
> silently break the parallel `dev:node` path. That path (plus `db:migrate`) survived Phase 2, so
> the manual two-script switch is permanent, and both scripts now also cover `node-pty` (§4c).

**Phase 2 — Cut Cloudflare. ✅ DONE.** Deleted `wrangler.jsonc`, `worker-configuration.d.ts`,
`vite.config.ts`, `.wrangler/`; removed `wrangler` + `@cloudflare/vite-plugin`; `.dev.vars`→`.env`.
Hand-wrote the global `Env` (`src/env.d.ts` → `RuntimeBindings`), simplified `getDb` to Node-only,
added `electron-builder.yml` (mac dmg/zip, `asarUnpack` the native `.node`, migrations as
`extraResources` resolved via `process.resourcesPath`), reworked scripts (`build`→electron-vite,
`dist`→electron-builder, `db:migrate`→`tsx scripts/migrate.ts`, dropped `typegen`/`dev:web`), and
updated `CLAUDE.md`. Verified: `pnpm lint`, 88/88 tests, `pnpm build`, and `pnpm dev` boots clean.
The release workflow now builds the packaged `.dmg` on pushes to `main` and uploads it as an
artifact. The data root resolves to `app.getPath('userData')`, migrations are packaged as resources,
native modules and ripgrep are unpacked, and `SESSION_ENC_KEY` self-provisions through
`safeStorage`. Release CI embeds the dedicated OAuth application's credentials through the
build-time fallback; device flow remains the distribution hardening follow-up.

**Phase 3 — Desktop-native cleanups + features.** Caching simplification (§5) **✅ done**. The
**v2 terminal** (§8) **✅ shipped** — node-pty sessions in the utility service, desktop-only and always
on. Still optional for broader distribution: GitHub device flow (drop `client_secret`).

Each phase is independently shippable and Phase 0–1 are reversible (Cloudflare config still there
until Phase 2). That's the clean transition.

## 8. What this does to the terminal feature

The original terminal RFCs designed around a Worker's *lack* of a process model — a separate
local daemon + a Vite WebSocket proxy. **Electron removed that entire workaround**, and the feature
has since been **built** (`plugins/terminal/src/main/terminal.ts`, registered by the service runtime at startup,
desktop-only and always on):

- node-pty runs **in Electron's supervised Node utility process**. No separate daemon, no Vite
  proxy, and no terminal-specific WebSocket server.
- Renderer request/response uses the loopback HTTP API; xterm input/output and status use the one
  authenticated WebSocket. Preload IPC is limited to native capabilities.
- tmux-backed persistence applies for surviving an app restart; surviving a *window* reload is
  automatic since the PTY outlives the renderer window.
- The `@electron/rebuild` step from §4c covers node-pty's native build (`electron:rebuild` rebuilds
  both native modules).
- The terminal service shares the server's single SQLite connection, handed to it (with
  `INTERNAL_TOKEN`, §4b) by the composition root (§10).

Net: the terminal got simpler and more native, exactly as predicted. The shipped feature is
documented in [terminal-and-agents.md](./terminal-and-agents.md) (its design record, `vNext.md`,
is removed — see git history).

## 9. Risks & open questions

1. ~~**Pinned app port** must be free~~ — **resolved, by removing the pin.** The risk was real and
   the mitigation listed here ("a dynamic fallback creates a new IndexedDB origin") is exactly what
   blocked it. vNext Phase 1 removed the blocker instead: the renderer's storage origin is the
   constant `app://acorn`, so it no longer depends on the port at all, and the node binds an
   **ephemeral** port and *reports* where it bound. The last bound port is remembered in `node.json`
   so a restart usually lands back on the same one, and falls back to ephemeral when it is taken.
   Single-instance startup is still enforced, and the data root's exclusive pidfile lock is now the
   real mutual exclusion. Two nodes on one machine went from impossible to ordinary.
2. ~~**`client_secret` in the binary**~~ — **resolved.** GitHub connects by the device authorization
   grant, which exchanges on `client_id` alone; nothing reads `GITHUB_CLIENT_SECRET` (§4f).
3. ~~**Service worker masking app updates**~~ — resolved: the service worker was removed (§4h).
4. ~~**Packaged migrations/native modules**~~ — resolved in the current package: migrations are
   extra resources, native modules/ripgrep are unpacked, and paths resolve from app resources.
   Signed/notarized distribution still needs its own install-time smoke test.
5. **Auto-update** — `electron-builder` supports it, but it's new surface vs. "redeploy a Worker."
   Fine for a personal tool; decide later if distributing.

**Decided:**
- **macOS-only.** No Windows/Linux builds. Packaging targets `dmg`/`zip`; ad-hoc signing for
  personal use, Developer ID + notarization only if distributing (§4i).
- **Native rebuilds via `@electron/rebuild`** (§4c) for both `better-sqlite3` and `node-pty` — kept
  as explicit `electron:rebuild` / root `rebuild:node` scripts rather than a `postinstall`, since the
  plain-Node dev paths need the opposite ABI.

## 10. Dependency delta

**Remove:** `wrangler`, `@cloudflare/vite-plugin`.
**Add:** `electron`, `electron-vite`, `electron-builder`, `@hono/node-server`, `better-sqlite3`,
`@types/better-sqlite3`, `@electron/rebuild`. (`node-pty` arrived with the v2 terminal. No `dotenv`
was needed — the main process uses Node's built-in `process.loadEnvFile`, and `dev:node` passes
`--env-file=.env`.)
**Unchanged:** `hono`, `drizzle-orm`, `drizzle-kit`, `jose`, `solid-js`, `@solidjs/router`,
TanStack Query, `shiki`, `idb-keyval`.

The runtime moves; the application doesn't.

## 11. Composition root & lifecycle

There are two explicit composition roots. `apps/desktop/src/app/main/bootstrap.ts` is the thin
Electron-native host: `electron.ts` calls it once from `app.whenReady()`, and it owns native adapters,
service supervision, window timing, recovery, and quit coordination.
`apps/desktop/src/app/service/runtime.ts` is Electron-free and owns the application runtime.
The ordered phases are:

```text
main: fork utility process
  → service: migrate (openDb runs migrations)
  → construct domain services (knowledge, runtime, workflow, …)
  → install HTTP/WS bridges
  → start loopback listener (startListener — only now do requests get served)
  → acknowledge listening
  → main: create window
  → service: reconcile durable state (tmux/worktrees/workflows) off the paint path
  → quit: service drains automation + loopback listeners, PTYs/watchers, pg pools, then SQLite
  → main disposes preview views/picker IPC and terminates the utility process
```

The service/main channel is a versioned, zod-validated, bidirectional request protocol
(`@acorn/protocol/serviceProtocol.ts`). Service-to-main calls expose only task-addressed preview/CDP
operations; no database handles, `WebContents` ids, or process objects cross the boundary. Pending
calls have timeouts and fail when the peer exits. Main retries an unexpected exit at most three
times per minute with exponential backoff, then fails closed instead of looping forever.

Three invariants this closes: synchronous database/Git/process work cannot block Electron's event
loop; the listener starts **after** every harness/context bridge
is installed — no more boot-order window where `/api/tasks/:id/notes` 503s — and there is now a
coordinated, idempotent `will-quit` teardown tolerant of a partial boot. `terminal.ts`
is no longer the accidental `main()`: it is the PTY engine, and the composition root injects what it needs
(`memoryInjector`, `memoryReviewTrigger`, `seedTaskNotes`, `internalApiEnv`) and consumes what it
exports (`sendToAgent`, `terminalRunGlue`, `reconcileTmux`, `disposeTerminal`). Boot/reconcile/teardown
timing marks are logged as `[service:boot] <label> +Nms` lines (performance §3.1).

## 12. Current transport: the connection broker, `/v2` over pinned TLS, and one WebSocket

vNext Phase 1 **inverted** the invariant this section used to state ("every request/response verb is
HTTP; every stream is the WebSocket; renderer↔main IPC carries only true Electron capabilities").
Request/response *and* streams both ride IPC now, because Electron main is where the pinned
certificate and the device token live and the renderer must never hold either. The upside is that the
renderer needs no network permission at all, which is what lets its CSP say `connect-src 'self'`.

The current split is:

- **Renderer → Electron main: seven broker primitives over preload IPC.** `nodeFetch(nodeId, request)`,
  `nodeAbort`, `nodeSend(nodeId, frame)`, `onNodeFrame`, `onNodeStatus`, `fleetList`, plus the
  owner-initiated fleet mutations. Bodies cross as **bytes**, because that is the one representation
  structured-clone carries losslessly for JSON, text and binary alike — and a zero-length body is how
  a 204 arrives, which is the whole reason the renderer used to need raw-fetch escape hatches. No
  closure crosses the bridge, so `nodeSocket()` is assembled renderer-side from `nodeSend` +
  `onNodeFrame`. Every request is Zod-parsed in main (`nodeBrokerIpc.ts`).
- **Electron main → node: HTTPS with a pinned certificate.** `main/nodeBroker.ts` holds, per node, the
  endpoint, a pinned `https.Agent`, the device token, one WebSocket, and the connection state
  (`online | degraded | offline | incompatible | revoked`). It is Electron-free by design — it imports
  `node:https` and `ws` and nothing from `electron` — so it is unit-testable against a real TLS server.
  Reconnect backoff is 1/2/4/8/16/30 s jittered, and a reconnect marks the active node's cache stale.
- **Request/response → typed `/v2` routes.** Every former `ipcMain.handle` domain (search, editor, run,
  workflow, local-git, database, knowledge/notes+memory, terminal control, MCP inspect) is a typed
  route under `/v2/core/*` in `@acorn/node-core/server/routes/*` or `/v2/p/<plugin>/*` in
  `plugins/*/src/server/routes/*`. Route builders + response types live in `@acorn/protocol/api.ts`;
  clients call through `readJson`/`writeJson`. Domain logic stays in the node behind a **bridge** — a
  route holds a `bridgeSlot`, the composition root fills it at boot
  (`@acorn/node-core/server/bridge.ts` `viaBridge` → 503 `bridge-unavailable` when unfilled). Pure-Node
  bridges (search/editor/local-git/database) are wired by both the supervised and the standalone
  composition entries. Bodies that write files, spawn processes, or execute SQL are Zod-validated with
  malformed-body tests.
- **Streams → one authenticated WebSocket per node** at **`/v2/events`** (`@acorn/protocol/ws.ts`,
  `@acorn/node-core/main/wsHub.ts`, `@acorn/client-core/wsClient.ts`). V1's flat kind-tagged frame
  vocabulary is deliberately kept: `term:out` (PTY output, coalesced to ~16 ms), `term:input`,
  attach/detach, the `term:status` + `workflow:notice` pings, the docker log/stats/exec channels, and a
  reserved `workflow:step:event`. Attach sends `ready`, then a serialized canonical terminal
  framebuffer, then any live frames buffered while serialization ran (deterministic
  snapshot-before-live ordering). Each frame carries a **per-connection `seq`** so the client can
  detect loss and treat a gap as a reconnect. The upgrade is authorized before the handshake: the Host
  guard plus a **device bearer** in the upgrade headers, or the internal token for a child process —
  anything else is a 403. There is no Origin check and no cookie: a broker socket from main is not a
  browser socket, and there is no ambient credential for an Origin check to defend. A presented-but-bad
  bearer does **not** fall back to the internal token. Revoking a device closes its live sockets
  immediately, with a 60 s `isActive()` sweep as the backstop for a revoke this hub never heard about.
- **Renderer↔main IPC also carries the true Electron capabilities:** the `preview:*` browser-preview
  channels (drive a main-owned `WebContentsView` per task — see below), `term:repoPath:pick`
  (`dialog.showOpenDialog`), the `acorn:close-pane` main→window ⌘W ping and the will-quit handshake,
  the node recovery screen's two native actions, plus the `desktop`/`platform` probes. (The old
  `browser:bind` handle is gone — with the preview main-owned, the CDP driver binds inside main when
  the view is created, so no `webContents` id ever crosses the bridge.)
- **Browser preview — main-owned `WebContentsView`:** one kept-alive view per task,
  parented to the window's `contentView` and positioned by the renderer over the pane's host rect
  (`previewService.ts` + `PreviewPane.tsx`). Replaces the deprecated `<webview>` tag: surviving
  pane/task switches is the view's natural behaviour, not a DOM-reparenting hack. http(s)-only /
  no-userinfo navigation is enforced per-view (`isAllowedPreviewUrl`), replacing the old
  `will-attach-webview` guard. A native view always paints above web content, so the renderer hides
  it when an overlay covers the pane. The main-owned record also retains the resolved home URL and
  owning window: a changed home reconciles on remount, and closing the window closes/unbinds every
  child view before macOS can create a replacement window.
- **Service↔main RPC — lifecycle plus native adapters:** `@acorn/protocol/serviceProtocol.ts` defines
  versioned, Zod-validated request/response/event envelopes over an ordinary Node IPC channel
  (`stdio: [..., 'ipc']`). The structural shim over Electron's `process.parentPort` is gone — with a
  plain child process there is nothing Electron-shaped left to describe.
  `@acorn/protocol/desktopCapabilities.ts` projects task-addressed preview and CDP/browser operations
  from main back into the service. Calls are concurrent and timed; peer exit rejects pending work.
  Only serializable DTOs cross—never a database connection, child-process object, or
  `webContents` id.

### Capability map (`dev:node` / plain browser)

`dev:node` runs the Hono app under plain Node with no Electron and no PTY engine. It does not crash;
surfaces degrade by whether their bridge is pure-Node or engine-backed:

| Surface | `dev:node` | Why |
| --- | --- | --- |
| PR review, workspaces, tasks, integrations, prefs | ✅ works | server-only (DB + GitHub), never needed IPC |
| search, editor, local-git, database, Docker, agent usage | ✅ works | pure-Node bridges wired by both composition roots |
| HTTP client | ✅ works | executes directly in its authenticated Hono route |
| terminal drawer, agents, run targets, workflows, MCP inspect | ⛔ 503 | need the supervised runtime engine (wired only in `apps/node/src/service/runtime.ts`) |
| PTY streams + `workflow:notice` (WebSocket) | ⚠️ connects, no data | the socket authorizes, but no engine registers stream handlers |
| folder picker, drivable browser, ⌘W | ⛔ absent | true Electron capabilities (no `window.acorn` bridge) |
| the SPA itself | ⛔ absent | the node serves no web assets — there is no shell to load in a browser |

Client surfaces that need the engine key off `capabilities().terminal` (the residual
`window.acorn.terminal` marker) and hide or show a reason when it's absent.

Two consequences of the standalone entry being the same code path, worth stating: a node paired from
another machine has the **same** degraded set, because `standalone.ts` wires only the pure-Node
bridges (making a remote task's terminal work end-to-end is a Phase 4 exit criterion); and the
`dev:node` row for "PR review, workspaces, tasks…" now means *reachable over `/v2` with a device
token*, not *browsable in Chrome*.
