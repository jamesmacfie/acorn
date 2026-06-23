# gurthurd

A GitHub pull-request review tool. A **SolidJS SPA** served by a **Hono Worker** on
Cloudflare, with a **D1** mirror of GitHub data and a **KV** blob cache for diff/patch
bodies. It is a **one-Worker architecture**: a single Worker serves the API/auth routes
and falls back to the SPA shell for everything else.

- `/api/*` and `/auth/*` are handled by the Worker (`run_worker_first`).
- All other paths serve `index.html` (SPA, `not_found_handling: single-page-application`).

## Monorepo layout

pnpm workspace + Turborepo.

```
.
├── apps/
│   └── web/            # the app: SolidJS client + Hono Worker (@gurthurd/web)
├── packages/           # (reserved)
├── package.json        # root scripts proxy to turbo
├── turbo.json
└── pnpm-workspace.yaml
```

All app code lives in `apps/web`:

- `src/client/` — SolidJS SPA (router, TanStack Query, Shiki diff rendering).
- `src/server/` — Hono Worker: `routes/`, `middleware/`, `db/` (Drizzle schema), `session.ts`.
- `migrations/` — Drizzle-generated D1 SQL migrations.

## Prerequisites

- **Node** ≥ 20 (developed on 24).
- **pnpm 11** — the repo pins `packageManager: pnpm@11.0.0`. Run `corepack enable` to get it.
- A **GitHub OAuth App** (one for dev, one for production — see below).
- **Wrangler** is installed as a dev dependency; invoke it with `pnpm --filter @gurthurd/web exec wrangler …` (or `pnpm wrangler …` from `apps/web`).

## Local setup

### 1. Create a dev GitHub OAuth App

A GitHub OAuth App allows exactly **one** callback URL, so dev needs its own app, separate
from production.

- GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.
- Homepage URL: `http://localhost:5173`
- **Authorization callback URL: `http://localhost:5173/auth/callback`** (the dev server port
  is pinned to `5173` in `apps/web/vite.config.ts`).
- Copy the **Client ID** and generate a **Client Secret**.

The OAuth flow requests these scopes (`src/server/routes/auth.ts`): `repo read:org read:user`.

### 2. Configure local secrets — `apps/web/.dev.vars`

Wrangler reads local dev secrets from `apps/web/.dev.vars` (this is **not** `wrangler secret
put`, which is for production). Copy the example and fill it in:

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars
```

Generate the session encryption key. `SESSION_ENC_KEY` must be **exactly 64 hex characters
(32 bytes / 256-bit)** — it is the key for the AES-256-GCM (JWE `dir`) session cookie, and
`src/server/session.ts` rejects anything not matching `^[0-9a-fA-F]{64}$`:

```bash
openssl rand -hex 32
```

`.dev.vars` then contains:

```
GITHUB_CLIENT_ID=<from your OAuth App>
GITHUB_CLIENT_SECRET=<from your OAuth App>
SESSION_ENC_KEY=<the 64-hex-char openssl output>
```

`.dev.vars` and `.wrangler/` are gitignored — never commit them.

### 3. Install, migrate, run

```bash
pnpm install

# Apply migrations to the local D1 database (Miniflare state under apps/web/.wrangler/state)
pnpm --filter @gurthurd/web db:migrate

# Start the dev server (Vite + vite-plugin-solid for the SPA, @cloudflare/vite-plugin
# runs the Hono Worker in Miniflare with local D1/KV)
pnpm --filter @gurthurd/web dev
```

Open `http://localhost:5173` and log in with GitHub.

> Local gotcha: over `http://localhost` the session cookie drops the `__Host-` prefix and the
> `Secure` flag (browsers reject `__Host-` on plain http). The Worker handles this
> automatically (`cookieAttrs` in `session.ts`).

## Common scripts

Run from the repo root via Turborepo, or per-package with `--filter @gurthurd/web`.

| Script | What it does |
| --- | --- |
| `pnpm dev` / `pnpm --filter @gurthurd/web dev` | Vite dev server + Worker in Miniflare |
| `pnpm build` / `pnpm --filter @gurthurd/web build` | `vite build` (client + Worker bundle) |
| `pnpm lint` / `pnpm --filter @gurthurd/web lint` | `tsc --noEmit` typecheck |
| `pnpm --filter @gurthurd/web typegen` | `wrangler types` → regenerate `worker-configuration.d.ts` (`Env`) |
| `pnpm --filter @gurthurd/web db:generate` | `drizzle-kit generate` — emit a migration from the schema |
| `pnpm --filter @gurthurd/web db:migrate` | `wrangler d1 migrations apply gurthurd --local` |

(`pnpm test` is wired through turbo but the package has no `test` script yet.)

## Database migrations

The schema lives in `apps/web/src/server/db/schema.ts` (Drizzle, SQLite dialect). To change it:

```bash
# 1. Edit src/server/db/schema.ts
# 2. Generate the SQL migration into apps/web/migrations/
pnpm --filter @gurthurd/web db:generate

# 3. Apply it to the LOCAL D1 (note the --local flag, baked into db:migrate)
pnpm --filter @gurthurd/web db:migrate
```

**Drizzle quirk — NOT NULL columns on populated tables.** When you add a `NOT NULL` column to
a table that already has rows, drizzle-kit emits a table-rebuild migration (`__new_*` table +
`INSERT … SELECT` to copy old rows + `DROP`/`RENAME`). That copy step is invalid when the new
column has no source value and must be **trimmed by hand** — see `migrations/0001` and `0002`,
where the copy was removed and the table simply recreated empty (the data hadn't been
populated yet). A plain **nullable** `ADD COLUMN` generates a clean one-line statement and
needs no editing.

## Production deploy

Deploy targets a real Cloudflare account, so you must provision real D1/KV resources and set
production secrets. Run these from `apps/web` (prefix wrangler with `pnpm` since it's a dev
dependency).

### 1. Create the resources

```bash
pnpm wrangler d1 create gurthurd                # prints a database_id
pnpm wrangler kv namespace create OAUTH_STATE   # prints an id
pnpm wrangler kv namespace create BLOBS         # prints an id
```

### 2. Put the real ids into `apps/web/wrangler.jsonc`

Replace the local placeholder ids (`00000000-…`) with the values printed above:

- `d1_databases[0].database_id` ← the D1 `database_id`
- the `OAUTH_STATE` and `BLOBS` `kv_namespaces` ids ← their respective ids

The binding **names** (`DB`, `OAUTH_STATE`, `BLOBS`) and `migrations_dir: "migrations"` are
contractual — the code and migration tooling reference them, so don't rename them.

### 3. Set production secrets

`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `SESSION_ENC_KEY` are all **secrets** (read
from `c.env.*` at runtime; locally they come from `.dev.vars`). In production set them with:

```bash
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm wrangler secret put SESSION_ENC_KEY      # a fresh `openssl rand -hex 32` (64 hex chars)
```

### 4. Apply migrations to remote D1

```bash
pnpm wrangler d1 migrations apply gurthurd --remote
```

### 5. Build & deploy

```bash
pnpm --filter @gurthurd/web build
pnpm wrangler deploy
```

### 6. Production OAuth App

Because a GitHub OAuth App allows only one callback URL, register a **second** OAuth App (or
update the callback) for the production URL, with the callback set to
`https://<your-domain>/auth/callback`. Use its Client ID / Secret for the production secrets
in step 3.

## Status / roadmap

**Built:**

- GitHub OAuth login (encrypted-cookie session, token never sent to the browser).
- Repo list.
- PR list with open/closed tabs and filtering.
- PR detail: description, checks, conversation, labels.
- Diff rendering with Shiki syntax highlighting + virtualization.
- Write actions: merge, close, reopen, mark draft, comment, edit labels.
- Theme persistence and `j`/`k` keyboard navigation.
- IndexedDB client cache (TanStack Query persistence).

**Deferred to v2:**

- Inline diff comment threads.
- Split / word-level diff views.
- Service-worker offline shell.
- Re-run failed GitHub Actions.
- Pinned repos.
- Viewed-file tracking.
- Virtualized PR list.
- Fuzzy file finder / command palette.
