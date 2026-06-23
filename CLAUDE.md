# CLAUDE.md — aacorn

A GitHub pull-request review tool: a SolidJS SPA served by a single Hono Worker on Cloudflare,
backed by a D1 read-model mirror of GitHub data, a KV blob cache, and IndexedDB client
persistence.

> **For architecture/domain detail, read [docs/architecture-overview.md](./docs/architecture-overview.md) first.**

## Architecture (one Worker)

- A single Hono Worker (`apps/web/src/server/index.ts`) serves `/api/*` and `/auth/*`
  (`run_worker_first`); everything else falls back to the SPA shell `index.html`
  (`not_found_handling: single-page-application`).
- Data: GitHub → D1 (SQLite, via Drizzle) read-model mirror with ETag/TTL serve-then-
  revalidate; KV caches immutable public blob/patch bodies by SHA; IndexedDB persists the
  client query cache.
- Session: AES-256-GCM (JWE `dir`) encrypted cookie via `jose` (`session.ts`); the GitHub
  token never reaches the browser.

## Repo map

pnpm workspace + Turborepo; all app code is in `apps/web`.

- `apps/web/src/client/` — SolidJS SPA (router, TanStack Query, Shiki diffs, PullList /
  PullDetail / DiffView / RepoPicker, shortcuts). Detail: [docs/frontend.md](./docs/frontend.md),
  [docs/diff-rendering.md](./docs/diff-rendering.md), [docs/ui-design.md](./docs/ui-design.md),
  [docs/offline-pwa.md](./docs/offline-pwa.md).
- `apps/web/src/server/` — Hono Worker: `routes/`, `middleware/`, `github/`, `db/` (Drizzle
  schema), `session.ts`. Detail: [docs/api-reference.md](./docs/api-reference.md),
  [docs/authentication.md](./docs/authentication.md),
  [docs/github-integration.md](./docs/github-integration.md),
  [docs/data-layer.md](./docs/data-layer.md), [docs/caching.md](./docs/caching.md).
- `apps/web/migrations/` — Drizzle-generated D1 SQL migrations.
- `docs/` — all topic docs; pick the relevant one per the links above.

## Key commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server + Worker in Miniflare (port 5173) |
| `pnpm build` | `vite build` (client + Worker bundle) |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @aacorn/web db:generate` | `drizzle-kit generate` — emit a migration from the schema |
| `pnpm --filter @aacorn/web db:migrate` | apply migrations to local D1 (`--local`) |
| `pnpm --filter @aacorn/web typegen` | `wrangler types` → regenerate `worker-configuration.d.ts` (`Env`) |

## Conventions & gotchas

- **TypeScript strict; no `any`.** Match existing patterns and naming.
- **Schema change workflow:** edit `apps/web/src/server/db/schema.ts` → `db:generate` →
  `db:migrate`. After adding a binding/env, run `typegen`. (Drizzle quirk: a `NOT NULL` column
  on a populated table emits a table-rebuild migration whose `INSERT … SELECT` copy must be
  trimmed by hand — see [docs/local-development.md](./docs/local-development.md).)
- **Secrets** live in `apps/web/.dev.vars` (gitignored) locally and `wrangler secret put` in
  production — never commit them. `SESSION_ENC_KEY` must be **exactly 64 hex chars**
  (`openssl rand -hex 32`); `session.ts` rejects anything else.
- **Cache rule:** only **public** blob/patch bodies go in shared KV (keyed by SHA);
  private-repo content must not be cached in shared KV. See [docs/caching.md](./docs/caching.md).
- **Leftover dir name:** the build output directory `dist/gurthurd/` is a cosmetic leftover
  name from a prior rename — it is not a live reference and does not need fixing.
- **Before claiming done:** run `pnpm lint` (and `pnpm test` where relevant).
