# aacorn

A GitHub pull-request review tool. aacorn is a **SolidJS SPA** served by a single **Hono
Worker** on Cloudflare, backed by a **D1** read-model mirror of GitHub data, a **KV** blob
cache for diff/patch bodies, and **IndexedDB** client persistence. Log in with GitHub and you
get a fast, keyboard-driven review surface: searchable repo picker with pins, virtualized PR
lists, and a rich PR detail view with Shiki-highlighted diffs, unified/split toggle,
word-level intra-line diffs, inline review-comment threads, per-file "viewed" tracking, and
write actions (merge, close, reopen, draft/ready, comment, labels, review comments, rerun
Actions). It is a **one-Worker architecture**: a single Worker serves the API/auth routes and
falls back to the SPA shell for everything else.

- `/api/*` and `/auth/*` are handled by the Worker (`run_worker_first`).
- All other paths serve `index.html` (`not_found_handling: single-page-application`).

## Tech stack

- **Frontend:** SolidJS + `@solidjs/router`, TanStack Query (with async-storage persist),
  TanStack Virtual, Shiki for syntax highlighting, `diff` / `gitdiff-parser` for diff parsing.
- **Backend:** Hono on Cloudflare Workers; `jose` for the encrypted-cookie session.
- **Data:** Cloudflare D1 (SQLite) accessed via Drizzle ORM; KV for blob/patch caching;
  IndexedDB (`idb-keyval`) for client-side query persistence.
- **Build / tooling:** Vite + `@cloudflare/vite-plugin`, Wrangler, drizzle-kit, Vitest,
  TypeScript (strict). pnpm workspace + Turborepo monorepo.

## Monorepo layout

pnpm workspace + Turborepo.

```
.
├── apps/
│   └── web/            # the app: SolidJS client + Hono Worker (@aacorn/web)
├── packages/           # (reserved)
├── package.json        # root scripts proxy to turbo
├── turbo.json
└── pnpm-workspace.yaml
```

All app code lives in `apps/web`:

```
apps/web/
├── src/
│   ├── client/         # SolidJS SPA — router, TanStack Query, Shiki diff rendering,
│   │                   #   feature-owned diff / PR-detail modules, RepoPicker, shortcuts
│   ├── shared/         # typed API response contracts, route builders, query keys
│   └── server/         # Hono Worker
│       ├── index.ts    # Worker entry / route mounting
│       ├── routes/     # auth, me, pins, prefs, repos, pulls, pullDetail,
│       │               #   pullFiles, prActions
│       ├── middleware/
│       ├── github/     # GitHub API client
│       ├── db/         # Drizzle schema + D1 access
│       └── session.ts  # AES-256-GCM / JWE session cookie
├── migrations/         # Drizzle-generated D1 SQL migrations
└── wrangler.jsonc
```

## Local setup (condensed)

Full step-by-step (OAuth App creation, gotchas, scripts) is in
[docs/local-development.md](./docs/local-development.md).

Prerequisites: Node ≥ 20, pnpm 11 (`corepack enable`), and a **dev** GitHub OAuth App with
Homepage `http://localhost:5173` and callback `http://localhost:5173/auth/callback`.

```bash
# 1. Secrets — copy the example and fill it in
cp apps/web/.dev.vars.example apps/web/.dev.vars
#    Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and
#    SESSION_ENC_KEY (exactly 64 hex chars):
openssl rand -hex 32

# 2. Install
pnpm install

# 3. Apply local D1 migrations
pnpm --filter @aacorn/web db:migrate

# 4. Run (port 5173)
pnpm dev
```

Open `http://localhost:5173` and log in with GitHub.

### Common scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server + Worker in Miniflare |
| `pnpm build` | `vite build` (client + Worker bundle) |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @aacorn/web typegen` | `wrangler types` → regenerate `worker-configuration.d.ts` |
| `pnpm --filter @aacorn/web db:generate` | `drizzle-kit generate` — emit a migration |
| `pnpm --filter @aacorn/web db:migrate` | `wrangler d1 migrations apply aacorn --local` |

## Production deploy

Deploy targets a real Cloudflare account, so you must provision real D1/KV resources and set
production secrets. Run these from `apps/web` (prefix wrangler with `pnpm` since it's a dev
dependency).

### 1. Create the resources

```bash
pnpm wrangler d1 create aacorn                  # prints a database_id
pnpm wrangler kv namespace create OAUTH_STATE   # prints an id
pnpm wrangler kv namespace create BLOBS         # prints an id
```

### 2. Put the real ids into `apps/web/wrangler.jsonc`

Replace the local placeholder ids with the values printed above:

- `d1_databases[0].database_id` ← the D1 `database_id`
- the `OAUTH_STATE` and `BLOBS` `kv_namespaces` ids ← their respective ids

The binding **names** (`DB`, `OAUTH_STATE`, `BLOBS`), `database_name: "aacorn"`, and
`migrations_dir: "migrations"` are contractual — the code and migration tooling reference them,
so don't rename them.

### 3. Set production secrets

`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `SESSION_ENC_KEY` are read from `c.env.*` at
runtime (locally they come from `.dev.vars`). In production set them as secrets:

```bash
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm wrangler secret put SESSION_ENC_KEY        # a fresh `openssl rand -hex 32` (64 hex chars)
```

### 4. Apply migrations to remote D1

```bash
pnpm wrangler d1 migrations apply aacorn --remote
```

### 5. Build & deploy

```bash
pnpm --filter @aacorn/web build
pnpm wrangler deploy
```

### 6. Production OAuth App

Because a GitHub OAuth App allows only one callback URL, register a **second** OAuth App for
the production URL, with the callback set to `https://<your-domain>/auth/callback`. Use its
Client ID / Secret for the production secrets in step 3.

## Documentation

Detailed docs live in [`docs/`](./docs):

- [architecture-overview.md](./docs/architecture-overview.md) — system design; start here.
- [local-development.md](./docs/local-development.md) — full local setup & dev workflow.
- [authentication.md](./docs/authentication.md) — GitHub OAuth + encrypted-cookie session.
- [data-layer.md](./docs/data-layer.md) — D1 read-model mirror, Drizzle schema, migrations.
- [caching.md](./docs/caching.md) — D1/KV/IndexedDB caching and the public-vs-private rule.
- [github-integration.md](./docs/github-integration.md) — GitHub API client and write actions.
- [api-reference.md](./docs/api-reference.md) — Worker `/api/*` and `/auth/*` routes.
- [frontend.md](./docs/frontend.md) — SolidJS SPA structure, routing, state, queries.
- [diff-rendering.md](./docs/diff-rendering.md) — Shiki highlighting, virtualization, threads.
- [offline-pwa.md](./docs/offline-pwa.md) — service-worker offline app shell + web manifest.
- [ui-design.md](./docs/ui-design.md) — UI conventions, theming, keyboard model.
