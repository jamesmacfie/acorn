# acorn

A GitHub pull-request review tool — a **local macOS Electron app**. acorn is a **SolidJS SPA**
served by an in-process **Hono server** (`@hono/node-server`) running in the Electron main process,
backed by a **local SQLite** read-model mirror of GitHub data (better-sqlite3 + Drizzle), an
**on-disk** blob cache for diff/patch bodies, and **IndexedDB** client persistence. Log in with
GitHub and you get a fast, keyboard-driven review surface: searchable repo picker with pins,
virtualized PR lists, and a rich PR detail view with Shiki-highlighted diffs, unified/split toggle,
word-level intra-line diffs, inline review-comment threads, per-file "viewed" tracking, and write
actions (merge, close, reopen, draft/ready, comment, labels, review comments, rerun Actions).

The Electron main process starts the Hono server on `http://127.0.0.1:4317` and points a hardened
`BrowserWindow` at it, so the SPA and API are same-origin:

- `/api/*` and `/auth/*` are handled by the server; all other paths serve the SPA shell `index.html`.
- acorn was originally a Cloudflare Worker; the migration to Electron is documented in
  [docs/electron.md](./docs/electron.md).

## Tech stack

- **Frontend:** SolidJS + `@solidjs/router`, TanStack Query (with async-storage persist),
  TanStack Virtual, Shiki for syntax highlighting, `diff` / `gitdiff-parser` for diff parsing.
- **Backend:** Hono on `@hono/node-server` in the Electron main process; `jose` for the
  encrypted-cookie session.
- **Data:** local SQLite (`better-sqlite3`) via Drizzle ORM; on-disk dir for blob/patch caching;
  IndexedDB (`idb-keyval`) for client-side query persistence. All under `apps/web/.acorn/`.
- **Build / tooling:** electron-vite (main/preload/renderer), electron-builder (macOS packaging),
  drizzle-kit, Vitest, TypeScript (strict). pnpm workspace + Turborepo monorepo.

## Monorepo layout

pnpm workspace + Turborepo.

```
.
├── apps/
│   └── web/            # the app: Electron + SolidJS client + Hono server (@acorn/web)
├── packages/           # (reserved)
├── package.json        # root scripts proxy to turbo
├── turbo.json
└── pnpm-workspace.yaml
```

All app code lives in `apps/web`:

```
apps/web/
├── src/
│   ├── main/           # Electron main + Node bootstrap
│   │   ├── electron.ts #   window, navigation guards, OAuth window
│   │   ├── server.ts   #   @hono/node-server + static / SPA fallback
│   │   ├── bindings.ts #   DB + on-disk BLOBS + in-mem OAUTH_STATE + secrets
│   │   └── preload.ts  #   minimal sandboxed bridge
│   ├── client/         # SolidJS SPA — router, TanStack Query, Shiki diff rendering,
│   │                   #   feature-owned diff / PR-detail modules, RepoPicker, shortcuts
│   ├── shared/         # typed API response contracts, route builders, query keys
│   ├── env.d.ts        # hand-written global Env (binding contract)
│   └── server/         # Hono app
│       ├── index.ts    # createApp() factory / route mounting
│       ├── routes/     # auth, me, pins, prefs, repos, pulls, pullDetail,
│       │               #   pullFiles, prActions, integrations, …
│       ├── middleware/
│       ├── github/     # GitHub API client
│       ├── db/         # Drizzle schema + SQLite access
│       └── session.ts  # AES-256-GCM / JWE session cookie
├── migrations/         # Drizzle-generated SQLite migrations
├── electron.vite.config.ts
└── electron-builder.yml
```

## Local setup (condensed)

Full step-by-step (OAuth App creation, gotchas, scripts) is in
[docs/local-development.md](./docs/local-development.md).

Prerequisites: Node ≥ 20, pnpm 11 (`corepack enable`), and a GitHub OAuth App whose
**Authorization callback URL** is `http://127.0.0.1:4317/auth/callback` (the `127.0.0.1` form,
not `localhost`).

```bash
# 1. Secrets — create apps/web/.env with:
#    GITHUB_CLIENT_ID=...
#    GITHUB_CLIENT_SECRET=...
#    SESSION_ENC_KEY=...   (exactly 64 hex chars)
openssl rand -hex 32

# 2. Install
pnpm install

# 3. Build better-sqlite3 for Electron's ABI (once; see ABI note below)
pnpm --filter @acorn/web electron:rebuild

# 4. Build + launch the Electron app
pnpm dev
```

The window opens on `http://127.0.0.1:4317`; log in with GitHub. Migrations apply automatically on
startup.

> **better-sqlite3 ABI:** the native module builds for one ABI at a time. `pnpm dev` (Electron) needs
> the Electron ABI (`electron:rebuild`); `dev:node` / `db:migrate` (plain Node) need the Node ABI
> (`node:rebuild`).

### Common scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Build + launch the Electron app (`electron-vite build && electron-vite preview`) |
| `pnpm --filter @acorn/web dev:node` | Run just the Node server (no Electron) on `:4317` |
| `pnpm --filter @acorn/web build` | `electron-vite build` (main + preload + renderer) |
| `pnpm --filter @acorn/web dist` | `electron-vite build && electron-builder --mac` — produce the `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @acorn/web db:generate` | `drizzle-kit generate` — emit a migration |
| `pnpm --filter @acorn/web db:migrate` | `tsx scripts/migrate.ts` — apply migrations to local SQLite |

## Packaging (macOS)

```bash
pnpm --filter @acorn/web dist   # → apps/web/release/*.dmg and *.zip
```

For personal use the build is ad-hoc signed. To distribute the `.dmg` to other machines, add a
Developer ID identity + notarization in `apps/web/electron-builder.yml` (otherwise Gatekeeper blocks
it). Secrets are read from `apps/web/.env` in dev; packaged builds will read from the OS keychain
(planned — see [docs/electron.md](./docs/electron.md) §4b). Since a GitHub OAuth App allows only one
callback URL, use a dedicated OAuth App for the desktop build.

## Documentation

Detailed docs live in [`docs/`](./docs):

- [electron.md](./docs/electron.md) — the Cloudflare Workers → Electron migration (current runtime).
- [architecture-overview.md](./docs/architecture-overview.md) — system design; start here.
- [local-development.md](./docs/local-development.md) — full local setup & dev workflow.
- [authentication.md](./docs/authentication.md) — GitHub OAuth + encrypted-cookie session.
- [data-layer.md](./docs/data-layer.md) — SQLite read-model mirror, Drizzle schema, migrations.
- [caching.md](./docs/caching.md) — the three-tier cache (server / on-disk blobs / IndexedDB).
- [github-integration.md](./docs/github-integration.md) — GitHub API client and write actions.
- [api-reference.md](./docs/api-reference.md) — the server's `/api/*` and `/auth/*` routes.
- [frontend.md](./docs/frontend.md) — SolidJS SPA structure, routing, state, queries.
- [diff-rendering.md](./docs/diff-rendering.md) — Shiki highlighting, virtualization, threads.
- [offline-pwa.md](./docs/offline-pwa.md) — service-worker offline app shell + web manifest.
- [ui-design.md](./docs/ui-design.md) — UI conventions, theming, keyboard model.
