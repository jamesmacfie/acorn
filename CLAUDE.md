# CLAUDE.md — acorn

A **local macOS agent workspace** with first-class GitHub pull-request review. A SolidJS SPA is served by an
Hono server (`@hono/node-server`) running in a supervised Electron utility process, backed by a
local SQLite read-model mirror of GitHub data (better-sqlite3 + Drizzle), an on-disk blob cache,
and IndexedDB client persistence. An independent bearer-authenticated automation listener can be
enabled on a second loopback port; it is off by default.

> **For architecture/domain detail, read [docs/architecture-overview.md](./docs/architecture-overview.md) first.**
> For the Cloudflare-Workers→Electron migration history and rationale, see
> [docs/electron.md](./docs/electron.md); current topic docs describe the shipped Electron runtime.

## Architecture (one local service supervised by Electron)

- The Electron main entry (`apps/desktop/src/app/main/electron.ts`) calls the native composition
  root (`src/app/main/bootstrap.ts`), which starts and supervises `src/app/service/index.ts`.
  The Electron-free service root (`src/app/service/runtime.ts`) builds the runtime bindings and
  starts the Hono app (`src/core/server/index.ts`, a `createApp()` factory) under
  `@hono/node-server` on `http://127.0.0.1:4317`; main then points a hardened `BrowserWindow` at
  that origin. The server serves
  `/api/*` + `/auth/*` and falls back to the SPA shell `index.html` for other navigations.
- Process boundary: the utility service owns SQLite, HTTP/WebSocket listeners, PTYs/tmux,
  worktrees, Git/process execution, workflows, Docker/database services, reconciliation, and
  shutdown draining. Electron main owns `BrowserWindow`/`WebContentsView`, dialogs, `safeStorage`,
  navigation/keyboard policy, and supervision. `core/shared/serviceProtocol.ts` carries versioned,
  Zod-validated lifecycle RPC; `core/shared/desktopCapabilities.ts` exposes narrow task-addressed
  native operations. Serializable data crosses this boundary, never DB handles, process objects,
  or `webContents` identifiers.
- Data: GitHub → local SQLite (via Drizzle, `better-sqlite3`) read-model mirror with ETag/TTL
  serve-then-revalidate; an on-disk dir caches immutable blob/patch bodies by SHA for all repos; IndexedDB
  persists the client query cache. Server-side data lives under `apps/desktop/.acorn/` in development
  (gitignored) and Electron's `userData` root when packaged; IndexedDB stays in the browser partition.
- Bindings: `apps/desktop/src/core/main/bindings.ts` builds the object routes read via `c.env` (DB,
  in-memory `OAUTH_STATE`, on-disk `BLOBS`, secret stores, public-API services). It also protects the
  data root and persists the loopback internal token and active GitHub identity in mode-`0600`
  files. The global `Env` type is hand-written in `apps/desktop/src/env.d.ts`.
- Session: AES-256-GCM (JWE `dir`) encrypted cookie via `jose` (`session.ts`); the GitHub token
  never reaches the browser. Same-origin loopback keeps the cookie/CSRF/OAuth flow intact. Internal
  child processes authenticate with `x-acorn-internal`; that principal cannot make live GitHub
  calls or use the HTTP client as a secret oracle.

## Repo map

pnpm workspace + Turborepo; all app code is in `apps/desktop`. Source is organised into `core/` +
`plugins/` + `app/`, each split by runtime (`client` / `server` / `main` / `mcp` / `shared`). Hard
app/process boundaries and a shrinking ledger of legacy cross-feature coupling are enforced by
`src/core/boundaries.test.ts`.

- `apps/desktop/src/core/` — platform-owned contracts and services. `client/` (shell, registries,
  persistence, layout, prefs, palettes, tabs, tasks/workspaces, settings framework, WS client),
  `server/` (`createApp` factory, session/auth/csrf middleware, sync engine, route + integration-
  provider registries, Drizzle `db/`), `main/` (PTY/worktree primitives, bindings, server listener,
  MCP registration, agent-profile registry; these run in the utility service unless Electron-native),
  `mcp/` (stdio skeleton + tool projection), `shared/`
  (cross-process contracts: API, WS, terminal/notes/workflow protocols, service lifecycle, native
  capabilities).
- `apps/desktop/src/plugins/<name>/` — one folder per in-tree feature (github, linear, rollbar,
  editor, changes, notes, memory, context, preview, database, docker, http, model-providers,
  terminal, agents, workflows, profiles-{claude,codex,aider}, onboarding), each with
  `client`/`server`/`main` parts as needed. A plugin may import `core/` and explicit cross-plugin
  contribution points. Existing direct cross-feature imports are baselined and must not grow.
- `apps/desktop/src/app/` — the composition roots and contribution activation layer: `main/`
  (`bootstrap.ts` native supervision, `electron.ts` entry, native capability adapters), `service/`
  (Electron-free runtime composition and utility entry), `server/` (`providers.ts`,
  `routes.ts` register plugin contributions into core registries; `devNode.ts` is the `dev:node`
  entry), `client/` (`index.tsx` renderer entry + contribution activation).
- Detail docs: [docs/frontend.md](./docs/frontend.md), [docs/diff-rendering.md](./docs/diff-rendering.md),
  [docs/ui-design.md](./docs/ui-design.md), [docs/electron.md](./docs/electron.md),
  [docs/api-reference.md](./docs/api-reference.md), [docs/public-api.md](./docs/public-api.md),
  [docs/authentication.md](./docs/authentication.md),
  [docs/github-integration.md](./docs/github-integration.md), [docs/data-layer.md](./docs/data-layer.md),
  [docs/caching.md](./docs/caching.md), [docs/docker.md](./docs/docker.md), and
  [docs/http-client.md](./docs/http-client.md).
- `apps/desktop/migrations/` — Drizzle-generated SQLite migrations (applied on startup + via `db:migrate`).
- `docs/` — current architecture, feature, operations, and contributor documentation.

## Key commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Build + launch the Electron app (`electron-vite build && electron-vite preview`); window loads `127.0.0.1:4317` |
| `pnpm --filter @acorn/desktop dev:node` | Run just the Node server (no Electron) on `:4317` — needs Node-ABI better-sqlite3 (`node:rebuild`) |
| `pnpm --filter @acorn/desktop build` | Build main + service + MCP + preload + renderer and enforce the renderer-size budget |
| `pnpm --filter @acorn/desktop dist` | Run the gated build, then `electron-builder --mac` to produce `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | Rebuild native modules for Node, then run `vitest` |
| `pnpm --filter @acorn/desktop test:e2e` | Build/rebuild for Electron and run the Playwright desktop smoke suite |
| `pnpm --filter @acorn/desktop db:generate` | Generate a migration and replay-check the migration chain |
| `pnpm --filter @acorn/desktop db:check` | Replay all migrations against a fresh SQLite database |
| `pnpm db:locate` | Print the absolute path to this worktree's local SQLite database |
| `pnpm --filter @acorn/desktop db:migrate` | `tsx scripts/migrate.ts` — apply migrations to the local SQLite DB |

## Conventions & gotchas

- **TypeScript strict; no `any`.** Match existing patterns and naming.
- **Process ownership:** new domain engines belong in the Electron-free service graph; Electron
  main is only for native UI/OS adapters and service supervision. Some service-owned modules retain
  the historical `core/main`, `plugins/*/main`, or `app/main/*Wiring.ts` paths. Classify them by
  dependency graph and runtime, not the folder label. Keep service↔main payloads serializable and
  task-addressed; use HTTP/WebSocket for renderer-facing product APIs.
- **Schema change workflow:** edit `apps/desktop/src/core/server/db/schema.ts` → `db:generate` →
  `db:migrate` (or just launch — `openDb` migrates on startup). After changing the bindings shape,
  update the hand-written `Env` in `apps/desktop/src/env.d.ts`. (Drizzle quirk: a `NOT NULL` column on a
  populated table emits a table-rebuild migration whose `INSERT … SELECT` copy must be trimmed by
  hand — see [docs/local-development.md](./docs/local-development.md).)
- **Secrets** live in `apps/desktop/.env` (gitignored) in dev — never commit them. `SESSION_ENC_KEY`
  self-provisions via Electron `safeStorage` in packaged builds (`main/sessionKeyStore.ts`); an env
  key wins and is migrated into safeStorage, while an existing DB with neither key fails closed;
  `SESSION_ENC_KEY` must be **exactly 64 hex chars**
  (`openssl rand -hex 32`); `session.ts` rejects anything else. It also encrypts integration tokens
  and HTTP-client fields at rest via `encryptSecret`/`decryptSecret`, so it stays even if the cookie
  does not. GitHub OAuth credentials resolve from the data-root `.env`, then process environment,
  then build-time `MAIN_VITE_GITHUB_CLIENT_*` fallbacks used by the release workflow. The embedded
  client secret is recoverable from a distributed binary; device flow is the future fix, not a
  claim that the current package contains no secret.
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
- **Repo config trust:** executable `.acorn/config.toml` and workflow changes are hash-gated. Review
  and acknowledge the exact snapshot through `/api/tasks/:id/config-trust`; Docker matching config
  is declarative and is deliberately outside that executable-config gate.
- **Before claiming done:** run `pnpm lint` (and `pnpm test` where relevant).
