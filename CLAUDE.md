# CLAUDE.md — acorn

A GitHub pull-request review tool: a **local macOS Electron app**. A SolidJS SPA is served by an
in-process Hono server (`@hono/node-server`) running in the Electron main process, backed by a
local SQLite read-model mirror of GitHub data (better-sqlite3 + Drizzle), an on-disk blob cache,
and IndexedDB client persistence.

> **For architecture/domain detail, read [docs/architecture-overview.md](./docs/architecture-overview.md) first.**
> For the Cloudflare-Workers→Electron migration history and rationale, see
> [docs/electron.md](./docs/electron.md). Some topic docs below still describe Workers specifics and
> are being updated.

## Architecture (one local server in Electron)

- The Electron main process (`apps/web/src/main/electron.ts`) builds the runtime bindings, starts
  the Hono app (`apps/web/src/server/index.ts`, a `createApp()` factory) under `@hono/node-server`
  on `http://127.0.0.1:4317`, and points a hardened `BrowserWindow` at that origin. The server
  serves `/api/*` + `/auth/*` and falls back to the SPA shell `index.html` for other navigations.
- Data: GitHub → local SQLite (via Drizzle, `better-sqlite3`) read-model mirror with ETag/TTL
  serve-then-revalidate; an on-disk dir caches immutable public blob/patch bodies by SHA; IndexedDB
  persists the client query cache. Local data lives under `apps/web/.acorn/` (gitignored).
- Bindings: `apps/web/src/main/bindings.ts` builds the object routes read via `c.env` (DB,
  in-memory `OAUTH_STATE`, on-disk `BLOBS`, secrets). The global `Env` type is hand-written in
  `apps/web/src/env.d.ts`.
- Session: AES-256-GCM (JWE `dir`) encrypted cookie via `jose` (`session.ts`); the GitHub token
  never reaches the browser. Same-origin loopback keeps the existing cookie/CSRF/OAuth flow intact.

## Repo map

pnpm workspace + Turborepo; all app code is in `apps/web`.

- `apps/web/src/client/` — SolidJS SPA (router, TanStack Query, Shiki diffs, PullList /
  PullDetail / DiffView / RepoPicker, shortcuts). Detail: [docs/frontend.md](./docs/frontend.md),
  [docs/diff-rendering.md](./docs/diff-rendering.md), [docs/ui-design.md](./docs/ui-design.md).
- `apps/web/src/main/` — Electron main process + Node bootstrap: `electron.ts` (window, guards,
  OAuth window), `server.ts` (`@hono/node-server` + static/SPA), `bindings.ts` (DB/KV/secrets),
  `preload.ts`. Detail: [docs/electron.md](./docs/electron.md).
- `apps/web/src/server/` — Hono app: `routes/`, `middleware/`, `github/`, `db/` (Drizzle
  schema), `session.ts`. Detail: [docs/api-reference.md](./docs/api-reference.md),
  [docs/authentication.md](./docs/authentication.md),
  [docs/github-integration.md](./docs/github-integration.md),
  [docs/data-layer.md](./docs/data-layer.md), [docs/caching.md](./docs/caching.md).
- `apps/web/migrations/` — Drizzle-generated SQLite migrations (applied on startup + via `db:migrate`).
- `docs/` — all topic docs; pick the relevant one per the links above.

## Key commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Build + launch the Electron app (`electron-vite build && electron-vite preview`); window loads `127.0.0.1:4317` |
| `pnpm --filter @acorn/web dev:node` | Run just the Node server (no Electron) on `:4317` — needs Node-ABI better-sqlite3 (`node:rebuild`) |
| `pnpm --filter @acorn/web build` | `electron-vite build` (main + preload + renderer → `dist/client`) |
| `pnpm --filter @acorn/web dist` | `electron-vite build && electron-builder --mac` — produce the `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @acorn/web db:generate` | `drizzle-kit generate` — emit a migration from the schema |
| `pnpm --filter @acorn/web db:migrate` | `tsx scripts/migrate.ts` — apply migrations to the local SQLite DB |

## Conventions & gotchas

- **TypeScript strict; no `any`.** Match existing patterns and naming.
- **Schema change workflow:** edit `apps/web/src/server/db/schema.ts` → `db:generate` →
  `db:migrate` (or just launch — `openDb` migrates on startup). After changing the bindings shape,
  update the hand-written `Env` in `apps/web/src/env.d.ts`. (Drizzle quirk: a `NOT NULL` column on a
  populated table emits a table-rebuild migration whose `INSERT … SELECT` copy must be trimmed by
  hand — see [docs/local-development.md](./docs/local-development.md).)
- **Secrets** live in `apps/web/.env` (gitignored) in dev — never commit them; packaged builds read
  from the OS keychain (planned, Phase 3). `SESSION_ENC_KEY` must be **exactly 64 hex chars**
  (`openssl rand -hex 32`); `session.ts` rejects anything else. It also encrypts integration tokens
  at rest (e.g. Linear) via `encryptSecret`/`decryptSecret`, so it stays even if the cookie does not.
- **better-sqlite3 ABI:** the native module builds for *one* ABI at a time. `pnpm dev` (Electron)
  needs the Electron ABI (`pnpm --filter @acorn/web electron:rebuild`); `dev:node`/`db:migrate` (plain
  Node) need the Node ABI (`node:rebuild`). Switch with those scripts.
- **OAuth callback:** register `http://127.0.0.1:4317/auth/callback` (the `127.0.0.1` form, not
  `localhost`) on the GitHub OAuth app. See [docs/electron.md](./docs/electron.md) §4f.
- **Blob cache:** `BLOBS` is now a local on-disk dir keyed by SHA. The `if (!repoRow.private)` guard
  in `pullBlob.ts`/`prMirror.ts` was for *shared* Workers KV and is now vestigial on a single-user
  machine — slated for removal in Phase 3 (see [docs/electron.md](./docs/electron.md) §5).
- **Before claiming done:** run `pnpm lint` (and `pnpm test` where relevant).
