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

- The Electron main entry (`apps/desktop/src/app/main/electron.ts`) calls the composition root
  (`src/app/main/bootstrap.ts`), which builds the runtime bindings and starts the Hono app
  (`src/core/server/index.ts`, a `createApp()` factory) under `@hono/node-server` on
  `http://127.0.0.1:4317`, then points a hardened `BrowserWindow` at that origin. The server serves
  `/api/*` + `/auth/*` and falls back to the SPA shell `index.html` for other navigations.
- Data: GitHub → local SQLite (via Drizzle, `better-sqlite3`) read-model mirror with ETag/TTL
  serve-then-revalidate; an on-disk dir caches immutable public blob/patch bodies by SHA; IndexedDB
  persists the client query cache. Local data lives under `apps/desktop/.acorn/` (gitignored).
- Bindings: `apps/desktop/src/core/main/bindings.ts` builds the object routes read via `c.env` (DB,
  in-memory `OAUTH_STATE`, on-disk `BLOBS`, secrets). The global `Env` type is hand-written in
  `apps/desktop/src/env.d.ts`.
- Session: AES-256-GCM (JWE `dir`) encrypted cookie via `jose` (`session.ts`); the GitHub token
  never reaches the browser. Same-origin loopback keeps the existing cookie/CSRF/OAuth flow intact.

## Repo map

pnpm workspace + Turborepo; all app code is in `apps/desktop`. Since Phase 10 (docs/next) the source
is foldered into `core/` + `plugins/` + `app/`, each split by process (`client` / `server` / `main`
/ `mcp` / `shared`). Import rules are enforced by `src/core/boundaries.test.ts`.

- `apps/desktop/src/core/` — the platform, never imports a plugin. `client/` (shell, registries,
  persistence, layout, prefs, palettes, tabs, tasks/workspaces, settings framework, WS client),
  `server/` (`createApp` factory, session/auth/csrf middleware, sync engine, route + integration-
  provider registries, Drizzle `db/`), `main/` (PTY/worktree primitives, bindings, server listener,
  MCP registration, agent-profile registry), `mcp/` (stdio skeleton + tool projection), `shared/`
  (cross-process contracts: api, ws, terminal/notes/workflow protocols).
- `apps/desktop/src/plugins/<name>/` — one folder per in-tree feature (github, linear, rollbar,
  editor, changes, notes, memory, context, preview, database, terminal, agents, workflows,
  profiles-{claude,codex,aider}, onboarding), each with `client`/`server`/`main` parts as needed. A
  plugin may import `core/` and cross-plugin contribution points, never another plugin's internals.
- `apps/desktop/src/app/` — the composition root, the ONLY layer that imports plugins: `main/`
  (`bootstrap.ts` boot order, `electron.ts` entry, activation modules), `server/` (`providers.ts`,
  `routes.ts` register plugin contributions into core registries; `devNode.ts` is the `dev:node`
  entry), `client/` (`index.tsx` renderer entry + contribution activation).
- Detail docs: [docs/frontend.md](./docs/frontend.md), [docs/diff-rendering.md](./docs/diff-rendering.md),
  [docs/ui-design.md](./docs/ui-design.md), [docs/electron.md](./docs/electron.md),
  [docs/api-reference.md](./docs/api-reference.md), [docs/authentication.md](./docs/authentication.md),
  [docs/github-integration.md](./docs/github-integration.md), [docs/data-layer.md](./docs/data-layer.md),
  [docs/caching.md](./docs/caching.md). (Some still cite pre-foldering paths; the tree above is authoritative.)
- `apps/desktop/migrations/` — Drizzle-generated SQLite migrations (applied on startup + via `db:migrate`).
- `docs/` — all topic docs; pick the relevant one per the links above. `docs/next/` is the design
  history for this plugin-platform version (no longer an active build guide).

## Key commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Build + launch the Electron app (`electron-vite build && electron-vite preview`); window loads `127.0.0.1:4317` |
| `pnpm --filter @acorn/desktop dev:node` | Run just the Node server (no Electron) on `:4317` — needs Node-ABI better-sqlite3 (`node:rebuild`) |
| `pnpm --filter @acorn/desktop build` | `electron-vite build` (main + preload + renderer → `dist/client`) |
| `pnpm --filter @acorn/desktop dist` | `electron-vite build && electron-builder --mac` — produce the `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @acorn/desktop db:generate` | `drizzle-kit generate` — emit a migration from the schema |
| `pnpm --filter @acorn/desktop db:migrate` | `tsx scripts/migrate.ts` — apply migrations to the local SQLite DB |

## Conventions & gotchas

- **TypeScript strict; no `any`.** Match existing patterns and naming.
- **Schema change workflow:** edit `apps/desktop/src/core/server/db/schema.ts` → `db:generate` →
  `db:migrate` (or just launch — `openDb` migrates on startup). After changing the bindings shape,
  update the hand-written `Env` in `apps/desktop/src/env.d.ts`. (Drizzle quirk: a `NOT NULL` column on a
  populated table emits a table-rebuild migration whose `INSERT … SELECT` copy must be trimmed by
  hand — see [docs/local-development.md](./docs/local-development.md).)
- **Secrets** live in `apps/desktop/.env` (gitignored) in dev — never commit them. `SESSION_ENC_KEY`
  self-provisions via Electron `safeStorage` in packaged builds (`main/sessionKeyStore.ts`); an env
  key wins and is migrated into safeStorage, while an existing DB with neither key fails closed;
  `GITHUB_CLIENT_*` still need the environment. `SESSION_ENC_KEY` must be **exactly 64 hex chars**
  (`openssl rand -hex 32`); `session.ts` rejects anything else. It also encrypts integration tokens
  at rest (e.g. Linear) via `encryptSecret`/`decryptSecret`, so it stays even if the cookie does not.
- **better-sqlite3 ABI:** `better-sqlite3`/`node-pty` are native — a compiled `.node` matches *one*
  ABI at a time. `pnpm dev` (Electron) needs the Electron ABI; `pnpm test` / `dev:node` / `db:migrate`
  (plain Node) need the Node ABI. `pnpm test` self-heals — it rebuilds for the Node ABI first (a fast
  no-op when already there), so it works from any state. Afterwards run `pnpm run rebuild` (Electron
  ABI) before `pnpm dev`. (`node:rebuild`/`electron:rebuild` switch manually; the old
  `pnpm rebuild …` form is shadowed by the root `rebuild` script and always builds Electron.)
- **OAuth callback:** register `http://127.0.0.1:4317/auth/callback` (the `127.0.0.1` form, not
  `localhost`) on the GitHub OAuth app. See [docs/electron.md](./docs/electron.md) §4f.
- **Blob cache:** `BLOBS` is a local on-disk dir keyed by SHA (`patch:<sha>` / `filebody:<sha>`
  prefixes). The old Workers-KV-era `if (!repoRow.private)` public-only guard has been removed from
  `pullBlob.ts`/`prMirror.ts`; blobs are cached for all repos. See [docs/caching.md](./docs/caching.md).
- **Before claiming done:** run `pnpm lint` (and `pnpm test` where relevant).
