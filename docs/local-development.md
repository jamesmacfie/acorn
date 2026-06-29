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
- A **GitHub OAuth App** for dev (separate from production — see below).
- **Wrangler** ships as a dev dependency of `@acorn/web`; invoke it via
  `pnpm --filter @acorn/web exec wrangler …`, or `pnpm wrangler …` from inside `apps/web`.

## 1. Create a dev GitHub OAuth App

A GitHub OAuth App allows exactly **one** callback URL, so dev needs its own app, separate
from production.

- GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.
- **Homepage URL:** `http://localhost:5173`
- **Authorization callback URL:** `http://localhost:5173/auth/callback`
- Copy the **Client ID** and generate a **Client Secret**.

The dev server port is pinned to `5173` (`apps/web/vite.config.ts`). The OAuth flow requests
the scopes `repo read:org read:user`.

## 2. Configure local secrets — `apps/web/.dev.vars`

Wrangler reads local dev secrets from `apps/web/.dev.vars`. This is **not** `wrangler secret
put` — that command is for production only.

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars
```

Generate the session encryption key. `SESSION_ENC_KEY` must be **exactly 64 hex characters**
(32 bytes / 256-bit) — it is the key for the AES-256-GCM (JWE `dir`) session cookie, and
`src/server/session.ts` rejects anything not matching `^[0-9a-fA-F]{64}$`:

```bash
openssl rand -hex 32
```

Then fill `apps/web/.dev.vars`:

```
GITHUB_CLIENT_ID=<from your dev OAuth App>
GITHUB_CLIENT_SECRET=<from your dev OAuth App>
SESSION_ENC_KEY=<the 64-hex-char openssl output>
```

`.dev.vars` and `.wrangler/` are gitignored — **never commit them**.

## 3. Install, migrate, run

```bash
# From the repo root
pnpm install

# Apply migrations to the local D1 database
# (Miniflare state lives under apps/web/.wrangler/state)
pnpm --filter @acorn/web db:migrate

# Start the dev server: Vite + vite-plugin-solid for the SPA, and
# @cloudflare/vite-plugin running the Hono Worker in Miniflare with local D1/KV
pnpm dev
```

Open `http://localhost:5173` and log in with GitHub.

> **Local gotcha — cookie prefix.** Over `http://localhost` the session cookie drops the
> `__Host-` prefix and the `Secure` flag (browsers reject `__Host-` on plain http). The Worker
> handles this automatically (`cookieAttrs` in `session.ts`); no action needed.

## Common scripts

Run from the repo root via Turborepo, or per-package with `--filter @acorn/web`.

| Script | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server + Hono Worker in Miniflare |
| `pnpm build` | `vite build` (client bundle + Worker) |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @acorn/web typegen` | `wrangler types` → regenerate `worker-configuration.d.ts` (`Env`) |
| `pnpm --filter @acorn/web db:generate` | `drizzle-kit generate` — emit a migration from the schema |
| `pnpm --filter @acorn/web db:migrate` | `wrangler d1 migrations apply acorn --local` |

`pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm test` all proxy through Turborepo at the root.

## Database migrations

The schema lives in `apps/web/src/server/db/schema.ts` (Drizzle, SQLite dialect). To change it:

```bash
# 1. Edit src/server/db/schema.ts

# 2. Generate the SQL migration into apps/web/migrations/
pnpm --filter @acorn/web db:generate

# 3. Apply it to the LOCAL D1 (the --local flag is baked into db:migrate)
pnpm --filter @acorn/web db:migrate
```

> **Drizzle quirk — NOT NULL columns on populated tables.** When you add a `NOT NULL` column
> to a table that already has rows, drizzle-kit emits a table-rebuild migration (`__new_*`
> table + `INSERT … SELECT` to copy old rows + `DROP`/`RENAME`). That copy step is invalid
> when the new column has no source value and must be **trimmed by hand** — see
> `migrations/0001` and `0002`, where the copy was removed and the table recreated empty (the
> data hadn't been populated yet). A plain **nullable** `ADD COLUMN` generates a clean one-line
> statement and needs no editing.

For production (remote) migrations and the full deploy flow, see the root
[README](../README.md#production-deploy).
