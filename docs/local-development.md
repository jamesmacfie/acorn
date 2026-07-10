# Local development

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). `pnpm dev` now builds + launches the Electron app; secrets live in
> `apps/desktop/.env`; migrations apply on startup or via `pnpm db:migrate`. The wrangler/Miniflare/D1
> steps below are historical.

Clone → running → logged-in runbook for acorn. For the system design behind it, see
[architecture-overview.md](./architecture-overview.md).

## Prerequisites

- **Node** ≥ 20 (developed on 24).
- **pnpm 11** — the repo pins `packageManager: pnpm@11.0.0`. Run `corepack enable` to get
  the pinned version automatically.
- A **GitHub OAuth App** dedicated to the desktop app (an OAuth App allows one callback URL).
- **macOS** to produce a packaged build (`pnpm dist`); `pnpm dev` runs anywhere Electron does.

## 1. Create a GitHub OAuth App

A GitHub OAuth App allows exactly **one** callback URL, so the desktop app wants its own.

- GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.
- **Homepage URL:** `http://127.0.0.1:4317`
- **Authorization callback URL:** `http://127.0.0.1:4317/auth/callback` — use the `127.0.0.1`
  form (GitHub treats it as distinct from `localhost`).
- Copy the **Client ID** and generate a **Client Secret**.

The app origin is pinned to port `4317` (`ACORN_PORT` in `apps/desktop/src/main/server.ts`; an
`ACORN_PORT` environment variable overrides it, at the cost of a fresh IndexedDB origin) so the
browser storage and OAuth callback stay stable. The OAuth flow requests the scopes
`repo read:org read:user`.

## 2. Configure local secrets — `apps/desktop/.env`

Dev secrets live in `apps/desktop/.env`, loaded by the Electron main process (`process.loadEnvFile`)
and by `dev:node`. Packaged builds will read them from the OS keychain (planned — see
[electron.md](./electron.md) §4b).

```bash
cp apps/desktop/.env.example apps/desktop/.env
```

Generate the session encryption key. `SESSION_ENC_KEY` must be **exactly 64 hex characters**
(32 bytes / 256-bit) — it is the key for the AES-256-GCM (JWE `dir`) session cookie, and
`src/server/session.ts` rejects anything not matching `^[0-9a-fA-F]{64}$`:

```bash
openssl rand -hex 32
```

Then fill `apps/desktop/.env`:

```
GITHUB_CLIENT_ID=<from your OAuth App>
GITHUB_CLIENT_SECRET=<from your OAuth App>
SESSION_ENC_KEY=<the 64-hex-char openssl output>
```

`.env` is gitignored — **never commit it**.

## 3. Install and run

```bash
# From the repo root
pnpm install

# better-sqlite3 and node-pty are native: build them against Electron's ABI before
# `pnpm dev` (and back to the Node ABI with `node:rebuild` if you use dev:node / db:migrate).
pnpm --filter @acorn/desktop electron:rebuild

# Build + launch the Electron app. Migrations apply automatically on startup
# (openDb); the SQLite DB and blob cache live under apps/desktop/.acorn/.
pnpm dev
```

The Electron window opens on `http://127.0.0.1:4317`; log in with GitHub.

> **Cookie note.** The session cookie is plain `session` (no `__Host-` prefix, no `Secure` flag) —
> the server only ever runs on loopback http, so the HTTPS cookie branch was removed
> (`SESSION_COOKIE` in `session.ts`); no action needed.

> **Desktop-only features.** The terminal drawer, agent sessions, run targets, and workflows are
> always on in the Electron app; they require the preload bridge, so they're simply absent in a
> plain browser via `dev:node` (`capabilities()` in `apps/desktop/src/client/features/capabilities.ts`).

## Local data — `apps/desktop/.acorn/`

All server-side state lives under `apps/desktop/.acorn/` (gitignored), resolved relative to the
built main-process module — not under `~/Library/Application Support`:

- `acorn.sqlite` (+ WAL files) — the Drizzle/SQLite database: the GitHub mirror *and* acorn's own
  app-state (workspaces, tasks, review notes, prefs, encrypted integration tokens, the memory
  index).
- `blobs/` — immutable file/patch bodies keyed by SHA (the `BLOBS` cache).
- `worktrees/` — per-task git worktrees created by the terminal/agent features.

The mirror tables are disposable (they re-sync from GitHub on demand), but the same database file
holds app-state acorn owns — so deleting `.acorn/` wholesale resets *everything*: workspaces,
tasks, notes, review notes, and connected integrations, not just cached GitHub data. Client-side,
the TanStack Query cache persists in the app origin's IndexedDB and rebuilds itself on the next
fetch.

## Common scripts

Run from the repo root via Turborepo, or per-package with `--filter @acorn/desktop`.

| Script | What it does |
| --- | --- |
| `pnpm dev` | `electron-vite build && electron-vite preview` — build + launch the Electron app |
| `pnpm --filter @acorn/desktop dev:node` | Run just the Node server (no Electron) on `:4317` — needs the Node ABI, and a prior `build` (it serves `dist/client` and reads `index.html` at startup) |
| `pnpm --filter @acorn/desktop build` | `electron-vite build` (main + preload + renderer) |
| `pnpm --filter @acorn/desktop dist` | `electron-vite build && electron-builder --mac` — package the `.dmg`/`.zip` |
| `pnpm --filter @acorn/desktop electron:dev` | `electron-vite dev` — watch mode for main/preload; the window still loads `:4317` (renderer comes from the last-built `dist/client`, never the vite dev server) |
| `pnpm --filter @acorn/desktop electron:rebuild` / `node:rebuild` | switch the native ABI of better-sqlite3 + node-pty (Electron ↔ Node) |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @acorn/desktop db:generate` | `drizzle-kit generate` — emit a migration from the schema, then replay the full chain on a fresh throwaway DB (`scripts/check-migrations.ts`) |
| `pnpm --filter @acorn/desktop db:check` | Just the fresh-DB migration replay — catches the NOT-NULL table-rebuild quirk below |
| `pnpm --filter @acorn/desktop db:migrate` | `tsx scripts/migrate.ts` — apply migrations to local SQLite |

`pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm test` all proxy through Turborepo at the root.

`dev:node` and `db:migrate` run under plain Node, so they need the **Node ABI**
(`node:rebuild`) — after either, run `electron:rebuild` again before `pnpm dev`. `db:migrate`
targets `apps/desktop/.acorn/acorn.sqlite` by default; set `ACORN_DB_PATH` to point it elsewhere.
A wrong-ABI better-sqlite3 no longer dies with a bare `NODE_MODULE_VERSION` stack: `openDb`
(`src/main/bindings.ts`) catches the native load error and rethrows naming the right rebuild
script for the runtime you're in.

> **`node:sqlite` spike (docs/next Phase 9 B) — parked.** The built-in `node:sqlite` handles FTS5
> (porter) and transactions fine under the bundled Node, but Drizzle ships **no** `node:sqlite`
> driver (even latest 0.45.2 — only better-sqlite3/bun/durable/expo/op/proxy), so adopting it means
> the generic `sqlite-proxy` driver or dropping Drizzle. And `node-pty` keeps the dual-ABI rebuild
> alive regardless, so the payoff is halved. **Both native deps still need the ABI dance above.**

## Database migrations

The schema lives in `apps/desktop/src/server/db/schema.ts` (Drizzle, SQLite dialect). To change it:

```bash
# 1. Edit src/server/db/schema.ts

# 2. Generate the SQL migration into apps/desktop/migrations/
pnpm --filter @acorn/desktop db:generate

# 3. Apply it to the local SQLite DB (also applied automatically on app startup)
pnpm --filter @acorn/desktop db:migrate
```

> **Drizzle quirk — NOT NULL columns on populated tables.** When you add a `NOT NULL` column
> to a table that already has rows, drizzle-kit emits a table-rebuild migration (`__new_*`
> table + `INSERT … SELECT` to copy old rows + `DROP`/`RENAME`). That copy step is invalid
> when the new column has no source value and must be **trimmed by hand** — see
> `migrations/0001` and `0002`, where the copy was removed and the table recreated empty (the
> data hadn't been populated yet). A plain **nullable** `ADD COLUMN` generates a clean one-line
> statement and needs no editing.
>
> This no longer relies on you remembering: `db:generate` chains
> `scripts/check-migrations.ts`, which replays the whole migration chain on a fresh throwaway DB
> and fails naming the offending file/statement (with a hand-trim hint) the moment a bad copy is
> generated. `db:check` runs it standalone.

For packaging the app into a `.dmg`/`.zip`, see [Packaging](../README.md#packaging-macos) in the
root README and [electron.md](./electron.md) §4i. Packaged builds resolve their data root to
`app.getPath('userData')` (dev keeps the repo-local `.acorn/`); the remaining packaged-build gap is
secrets — there is no `.env` in a packaged app and OS-keychain storage is planned but not built, so
`.env` stays the dev-only source of secrets.

