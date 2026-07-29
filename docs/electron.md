# Electron runtime and migration record

> Status: **Migration complete.** Phases 0–2 done (Node-server spike + Electron shell + Cloudflare
> cut) plus the Phase 3 caching cleanup. The Hono app runs under `@hono/node-server` on
> `http://127.0.0.1:4317` with a better-sqlite3-backed Bindings object (typed stores — the KV shim
> is gone), wrapped in an Electron app. A supervised Node `utilityProcess` owns the
> server, SQLite, PTYs, Git/process work, and background reconciliation; Electron main owns only
> native windows/views/dialogs plus lifecycle supervision and loads the loopback origin.
> **Cloudflare/wrangler is fully removed** — Electron is the shipped product runtime; `dev:node`
> remains a supported development composition root for pure-Node server capabilities. The **v2
> terminal (§8) has since shipped**: node-pty
> sessions run in the utility service (`src/plugins/terminal/main/terminal.ts`, desktop-only and always on — see
> [terminal-and-agents.md](./terminal-and-agents.md)). `SESSION_ENC_KEY` now uses `safeStorage`;
> GitHub device flow (dropping `client_secret`) remains an optional distribution enhancement, not
> migration work. This doc is the full change inventory and the record of a clean, phased
> transition off Cloudflare Workers to a local Electron app — read it for the *why* behind the
> current runtime shape; [architecture-overview.md](./architecture-overview.md) describes what
> exists today.
>
> Companion doc: [terminal-and-agents.md](./terminal-and-agents.md) — the terminal/agent-session
> feature originally collapsed into Electron main as §8 predicted and now runs in the supervised
> utility service. (Its design record, `vNext.md`, is now removed — see git history.)
>
> **Phase 0 artifacts:** `apps/desktop/src/core/main/bindings.ts` (DB + `.batch` shim, in-mem `OAUTH_STATE`,
> on-disk `BLOBS`, secrets from `process.env`), `apps/desktop/src/core/main/server.ts` (node-server bootstrap
> + static + SPA fallback), `createApp()` factory in `src/core/server/index.ts`, DB driver swap in
> `src/core/server/db/index.ts`. Run with `pnpm --filter @acorn/desktop dev:node`. Local data lives under
> `apps/desktop/.acorn/` (gitignored).
>
> **Phase 1 artifacts:** `apps/desktop/src/app/main/electron.ts` (main process: starts the server, hardened
> BrowserWindow, navigation guard, dedicated OAuth window), `src/core/main/preload.ts` (minimal sandboxed
> bridge), `electron.vite.config.ts` (main/preload/renderer→dist/client), SW gate in
> `src/app/client/index.tsx`, loopback Host-header guard in `server.ts`. **`pnpm dev` now launches the
> Electron app** (`electron-vite build && electron-vite preview`; old Cloudflare dev server → `dev:web`),
> plus `electron:dev`, `electron:rebuild`/`node:rebuild` (native-module ABI switch — see caveat in
> §4i; the interim `electron:build` script was folded into `build`/`dist` in Phase 2). The window
> loads the node-server origin (`:4317`), never electron-vite's renderer dev server, so the SPA and
> `/api` stay same-origin and the session cookie/OAuth keep working. Originally verified headlessly
> (app boots, server binds, better-sqlite3 loads under Electron's ABI, SPA serves, the
> 401→/auth/login→OAuth-window→GitHub chain fires); the visible window and the full GitHub login
> round-trip have since been verified in daily use.

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
| D1 client | `src/core/server/db/index.ts:1,5` (`drizzle-orm/d1`, `env.DB`) | `drizzle-orm/better-sqlite3` |
| Migrations apply | `package.json` `db:migrate` (`wrangler d1 migrations apply`) | `drizzle-orm/better-sqlite3/migrator` on startup |
| KV `OAUTH_STATE` | `routes/auth.ts:41,77,78` (put TTL / get / delete) | in-memory `Map` with expiry |
| KV `BLOBS` | `routes/pullBlob.ts:33,43`, `routes/prMirror.ts:309,360` | on-disk cache dir keyed by sha |
| `waitUntil` | `routes/repoMirror.ts:27-28`, called from `pulls/repos/pullDetail/pullFiles` via `c.executionCtx` | fire-and-forget in Node (one helper) |
| Secrets / vars | `SESSION_ENC_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` via `c.env` + `.dev.vars` | `.env` / OS keychain → injected into Bindings |
| Worker entry | `src/core/server/index.ts:44` (`export default app`) | `@hono/node-server` `serve(app)` |
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

`src/core/server/index.ts` keeps building the same route graph, but exposes it as a factory so the Node
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

Add a Node bootstrap (new file, e.g. `src/core/main/server.ts`) that supplies runtime bindings through
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
  API_TOKENS: TokenService
  OAUTH_ACCOUNTS: OauthAccountService
  UI_BROKER: UiControlBroker
}
```

- **`OAUTH_STATE`** — 5-minute ephemeral CSRF state with atomic issue/consume semantics; no
  persistence wanted.
- **`BLOBS`** — immutable blob/patch bodies keyed by sha for public and private repos. Back it with a cache dir
  (`app.getPath('userData')/blobs/<sha>`), `.get` = read file, `.put` = write file. ~20 lines.
- **secrets** — read from `.env` in dev. `SESSION_ENC_KEY` falls through to Electron `safeStorage`
  in a packaged build (Phase 9 C, `sessionKeyStore.ts`): env always wins and is persisted as the
  env-only migration path; otherwise a fresh data root mints once. An existing `acorn.sqlite` with
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

`src/core/server/db/index.ts` is the *only* DB-runtime file, but the swap is **not** two lines — see the
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
  `app.isPackaged`, else the repo-local `apps/desktop/.acorn/` (so a dev checkout's data stays with
  the checkout) — and passes it into `startServer(dataDir)`; the plain-Node `dev:node` entry
  defaults to the repo-local dir (`devDataDir` in `main/server.ts`).
- Open SQLite with the desktop pragmas explicitly: `journal_mode = WAL` and a short
  `busy_timeout`. (`foreign_keys = ON` was deliberately dropped — the schema declares no FK
  constraints, so the pragma was a misleading no-op; see docs/data-layer.md.)
- Package migrations as readable resources (`extraResources` or an import-time manifest) and resolve
  `migrationsFolder` from `process.resourcesPath` / `import.meta.url`, never from `process.cwd()`.
- **Native-module rebuild (decided approach):** `better-sqlite3` must be rebuilt against Electron's
  ABI via `@electron/rebuild`. Wire it into a `postinstall` script in Phase 1 so it's automatic and
  CI-safe; this same setup covers `node-pty` for v2 (§8) — solve once. (Fallback only if it ever
  bites: `@libsql/client` prebuilds with `drizzle-orm/libsql`.)
  *What shipped differs:* the rebuild stayed **manual** (`electron:rebuild` / `node:rebuild`, both
  now covering `better-sqlite3` *and* `node-pty`) because the plain-Node paths (`dev:node`,
  `db:migrate`) outlived Phase 2 and need the Node ABI — a `postinstall` pinning the Electron ABI
  would silently break them. The two-script switch is the accepted trade-off.

### 4d. `waitUntil` shim

*(Historical — the helper has since been renamed `trackBackgroundRefresh` and moved to
`src/core/server/background.ts`.)*

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
`trackBackgroundRefresh(label, promise)` in `src/core/server/background.ts`) is a plain fire-and-forget
with error logging, the callers no longer read `c.executionCtx`, and `server.ts` passes no
execution-context stub. The Workers-era `waitUntilLogged` name is gone too.

### 4e. Static assets + SPA fallback

`wrangler.jsonc`'s `assets` block did two declarative things we now do in-app (shown in 4a):
serve `dist/client/*` and fall back unmatched SPA routes to `index.html`.

Be precise here: `run_worker_first` gave `/api/*` and `/auth/*` to the Worker even when no route
matched, so those paths should still return API/auth 404s, not the SPA shell. The fallback handler
must check the pathname and only serve `index.html` for non-API, non-auth navigation paths.

Use absolute paths for the renderer build in both dev and packaged modes. `serveStatic({ root:
'./dist/client' })` works from the repo root but breaks when the app is launched from Finder.

### 4f. OAuth in a desktop app

The current web flow (`routes/auth.ts`) works **almost unchanged** because the renderer runs on
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

The app should keep the HTTP API for product data, but Electron adds a new privileged boundary:
renderer ↔ preload ↔ main. Treat that as a narrow capability API, not a general bridge.

- Main app window: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and a preload
  that exposes only named methods needed by desktop features. Do not expose raw `ipcRenderer`.
- Navigation guard: the main app window may load only the local loopback origin. Open external links
  with `shell.openExternal`; never let arbitrary remote pages run with the app preload attached.
- Loopback server guard: bind only `127.0.0.1` and reject unexpected `Host` headers before routing.
  This keeps the local HTTP API scoped to the origin the Electron app actually uses.
- OAuth window: no preload and no Node integration (§4f). It is the only window allowed to visit
  `github.com`.
- Terminal request bodies are validated at the Hono/service boundary: session id, cwd, cols/rows,
  input bytes, and lifecycle commands. Native service↔main calls use the narrower versioned schemas
  in `core/shared/{serviceProtocol,desktopCapabilities}.ts`.
- Add a basic CSP for the renderer HTML. The app currently relies on same-origin fetch and GitHub
  API calls from the main/server side, so the renderer policy can stay tight.

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

- The SolidJS product UI (`src/core/client/**`, `src/plugins/*/client/**`, `src/app/client/**`) —
  router, TanStack Query, IndexedDB persistence, Shiki,
  all panels. It just loads from `http://127.0.0.1:<port>` instead of the Worker. The exception is
  the boot-time service-worker unregister in `src/app/client/index.tsx` (§4h).
- All 16 route modules' business logic and the Hono routing in `index.ts` (now a `createApp()` factory).
- The Drizzle **schema** and all migration SQL.
- The GitHub client (`github/index.ts`) — plain `fetch`.
- The session crypto (`session.ts`) — `jose` runs in Node.
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

Remaining one-time setup for OAuth login: register `http://127.0.0.1:4317/auth/callback` as a
loopback callback on the GitHub OAuth app (the only Phase 0 step that can't be verified headlessly).

**Phase 1 — Electron shell. ✅ DONE.** Wrapped
Phase 0 in Electron (`electron-vite` + `src/app/main/electron.ts` + `src/core/main/preload.ts`). The main
process starts the server then loads `http://127.0.0.1:4317`; navigation is locked to the loopback
origin, external links open in the system browser, and `/auth/login` is rerouted into a dedicated
sandboxed OAuth window. SW registration is gated out of the Electron renderer. `better-sqlite3` is
rebuilt against Electron's ABI via `pnpm electron:rebuild`. Verified headlessly that the app boots,
the server binds, the native module loads, the SPA serves, and the login redirect chain fires.

> **better-sqlite3 ABI caveat:** the native module can be built for the Node ABI *or* the Electron
> ABI, not both. `electron:rebuild` switches it to Electron (needed to run the app); `node:rebuild`
> switches it back for `dev:node`. This is why the rebuild is **not** a `postinstall` — that would
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
has since been **built** (`src/plugins/terminal/main/terminal.ts`, registered by the service runtime at startup,
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

1. **Pinned app port** must be free. If taken, the stable origin cannot start. Mitigation: enforce
   single-instance startup, pick an uncommon port, and surface a clear error. A dynamic fallback is
   possible, but it creates a new IndexedDB origin.
2. **`client_secret` in the binary** in current release artifacts (§4f) — device flow is the answer.
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
  as explicit `electron:rebuild`/`node:rebuild` scripts rather than a `postinstall`, since the
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
(`core/shared/serviceProtocol.ts`). Service-to-main calls expose only task-addressed preview/CDP
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

## 12. Current transport: loopback HTTP + one WebSocket + narrow native RPC

The current transport split is:

- **Request/response → loopback HTTP.** Every former `ipcMain.handle` domain (search, editor, run,
  workflow, local-git, database, knowledge/notes+memory, terminal control, MCP inspect) is a typed
  route under `/api/*` in `core/server/routes/*` or `plugins/*/server/routes/*`. Route builders +
  response types live in `core/shared/api.ts`; clients call through `readJson`/`writeJson`. Domain logic stays in the utility
  service behind a **bridge** — a route holds a `bridgeSlot`, the service side fills it at boot
  (`core/server/bridge.ts` `viaBridge` → 503 `bridge-unavailable` when unfilled). Pure-Node bridges
  (search/editor/local-git/database) are wired by the utility-service and `dev:node` composition entries.
  Bodies that write files, spawn
  processes, or execute SQL are zod-validated with malformed-body tests.
- **Streams → one authenticated WebSocket** at `/ws` (`core/shared/ws.ts`, `core/main/wsHub.ts`,
  `core/client/wsClient.ts`). Kind-tagged frames carry `term:out` (PTY output,
  coalesced to ~16 ms), `term:input`, attach/detach, the `term:status` + `workflow:notice` pings,
  and a reserved `workflow:step:event`. Attach sends `ready`, then a serialized canonical terminal
  framebuffer, then any live frames buffered while serialization ran (deterministic
  snapshot-before-live ordering). The upgrade is authorized on the shared
  loopback listener: Host guard + exact-Origin + a valid session cookie, or the internal token for
  the loopback MCP caller — anything else is a 403 before the handshake.
- **Renderer↔main IPC (`preload.ts`) — only true Electron capabilities:** the `preview:*` browser-preview
  channels (drive a main-owned `WebContentsView` per task — see below), `term:repoPath:pick`
  (`dialog.showOpenDialog`), and the `acorn:close-pane` main→window ⌘W ping, plus the
  `desktop`/`platform` probes. No domain API or domain stream remains on this IPC surface. (The old
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
- **Service↔main RPC — lifecycle plus native adapters:** `core/shared/serviceProtocol.ts` defines
  versioned, Zod-validated request/response/event envelopes over `utilityProcess` message ports.
  `core/shared/desktopCapabilities.ts` projects task-addressed preview and CDP/browser operations
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
| terminal drawer, agents, run targets, workflows, MCP inspect | ⛔ 503 | need the utility-process runtime engine (wired only in `app/service/runtime.ts`) |
| PTY streams + `workflow:notice` (WebSocket) | ⚠️ connects, no data | the socket authorizes, but no engine registers stream handlers |
| folder picker, drivable browser, ⌘W | ⛔ absent | true Electron capabilities (no `window.acorn` bridge) |

Client surfaces that need the engine key off `capabilities().terminal` (the residual
`window.acorn.terminal` marker) and hide or show a reason when it's absent.
