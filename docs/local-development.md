# Local development

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). `pnpm dev` now builds + launches the Electron app; secrets live in
> `apps/web/.env`; migrations apply on startup or via `pnpm db:migrate`. The wrangler/Miniflare/D1
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

The app origin is pinned to port `4317` (`ACORN_PORT` in `apps/web/src/main/server.ts`) so the
browser storage and OAuth callback stay stable. The OAuth flow requests the scopes
`repo read:org read:user`.

## 2. Configure local secrets — `apps/web/.env`

Dev secrets live in `apps/web/.env`, loaded by the Electron main process (`process.loadEnvFile`)
and by `dev:node`. Packaged builds will read them from the OS keychain (planned — see
[electron.md](./electron.md) §4b).

```bash
cp apps/web/.env.example apps/web/.env
```

Generate the session encryption key. `SESSION_ENC_KEY` must be **exactly 64 hex characters**
(32 bytes / 256-bit) — it is the key for the AES-256-GCM (JWE `dir`) session cookie, and
`src/server/session.ts` rejects anything not matching `^[0-9a-fA-F]{64}$`:

```bash
openssl rand -hex 32
```

Then fill `apps/web/.env`:

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

# better-sqlite3 is native: build it against Electron's ABI before `pnpm dev`
# (and back to the Node ABI with `node:rebuild` if you use dev:node / db:migrate).
pnpm --filter @acorn/web electron:rebuild

# Build + launch the Electron app. Migrations apply automatically on startup
# (openDb); the SQLite DB and blob cache live under apps/web/.acorn/.
pnpm dev
```

The Electron window opens on `http://127.0.0.1:4317`; log in with GitHub.

> **Local gotcha — cookie prefix.** Over `http://127.0.0.1` the session cookie drops the
> `__Host-` prefix and the `Secure` flag (browsers reject `__Host-` on plain http). The server
> handles this automatically (`cookieAttrs` in `session.ts`); no action needed.

## Common scripts

Run from the repo root via Turborepo, or per-package with `--filter @acorn/web`.

| Script | What it does |
| --- | --- |
| `pnpm dev` | `electron-vite build && electron-vite preview` — build + launch the Electron app |
| `pnpm --filter @acorn/web dev:node` | Run just the Node server (no Electron) on `:4317` |
| `pnpm --filter @acorn/web build` | `electron-vite build` (main + preload + renderer) |
| `pnpm --filter @acorn/web dist` | `electron-vite build && electron-builder --mac` — package the `.dmg`/`.zip` |
| `pnpm --filter @acorn/web electron:rebuild` / `node:rebuild` | switch better-sqlite3's native ABI (Electron ↔ Node) |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @acorn/web db:generate` | `drizzle-kit generate` — emit a migration from the schema |
| `pnpm --filter @acorn/web db:migrate` | `tsx scripts/migrate.ts` — apply migrations to local SQLite |

`pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm test` all proxy through Turborepo at the root.

## Database migrations

The schema lives in `apps/web/src/server/db/schema.ts` (Drizzle, SQLite dialect). To change it:

```bash
# 1. Edit src/server/db/schema.ts

# 2. Generate the SQL migration into apps/web/migrations/
pnpm --filter @acorn/web db:generate

# 3. Apply it to the local SQLite DB (also applied automatically on app startup)
pnpm --filter @acorn/web db:migrate
```

> **Drizzle quirk — NOT NULL columns on populated tables.** When you add a `NOT NULL` column
> to a table that already has rows, drizzle-kit emits a table-rebuild migration (`__new_*`
> table + `INSERT … SELECT` to copy old rows + `DROP`/`RENAME`). That copy step is invalid
> when the new column has no source value and must be **trimmed by hand** — see
> `migrations/0001` and `0002`, where the copy was removed and the table recreated empty (the
> data hadn't been populated yet). A plain **nullable** `ADD COLUMN` generates a clean one-line
> statement and needs no editing.

For packaging the app into a `.dmg`/`.zip`, see [Packaging](../README.md#packaging-macos) in the
root README and [electron.md](./electron.md) §4i.
