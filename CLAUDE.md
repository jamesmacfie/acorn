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
  root (`app/main/bootstrap.ts`), which starts and supervises `app/service/index.ts`.
  The Electron-free service root (`app/service/runtime.ts`) builds the runtime bindings and
  starts the Hono app (`@acorn/node-core/server/index.ts`, a `createApp()` factory) under
  `@hono/node-server` on `http://127.0.0.1:4317`; main then points a hardened `BrowserWindow` at
  that origin. The server serves
  `/api/*` + `/auth/*` and falls back to the SPA shell `index.html` for other navigations.
- Process boundary: the utility service owns SQLite, HTTP/WebSocket listeners, PTYs/tmux,
  worktrees, Git/process execution, workflows, Docker/database services, reconciliation, and
  shutdown draining. Electron main owns `BrowserWindow`/`WebContentsView`, dialogs, `safeStorage`,
  navigation/keyboard policy, and supervision. `@acorn/protocol/serviceProtocol.ts` carries versioned,
  Zod-validated lifecycle RPC; `@acorn/protocol/desktopCapabilities.ts` exposes narrow task-addressed
  native operations. Serializable data crosses this boundary, never DB handles, process objects,
  or `webContents` identifiers.
- Data: GitHub → local SQLite (via Drizzle, `better-sqlite3`) read-model mirror with ETag/TTL
  serve-then-revalidate; an on-disk dir caches immutable blob/patch bodies by SHA for all repos; IndexedDB
  persists the client query cache. Server-side data lives under `apps/desktop/.acorn/` in development
  (gitignored) and Electron's `userData` root when packaged; IndexedDB stays in the browser partition.
- Bindings: `packages/node-core/src/main/bindings.ts` builds the object routes read via `c.env` (DB,
  in-memory `OAUTH_STATE`, on-disk `BLOBS`, secret stores). It also protects the data root and
  persists the loopback internal token and active GitHub identity in mode-`0600` files. `Env` is an
  ordinary exported type there — it was an ambient `declare global`, which cannot work once each
  package compiles separately.
- Session: AES-256-GCM (JWE `dir`) encrypted cookie via `jose` (`session.ts`); the GitHub token
  never reaches the browser. Same-origin loopback keeps the cookie/CSRF/OAuth flow intact. Internal
  child processes authenticate with `x-acorn-internal`; that principal cannot make live GitHub
  calls or use the HTTP client as a secret oracle.

## Repo map

pnpm workspace + Turborepo, **25 packages**. Every first-party package is consumed as TypeScript
**source** through an `exports` map (`"./*": "./src/*"`) — there is no per-package build, no `.d.ts`
emit and no project references. Consequences worth knowing before you touch a manifest:

- **Cross-package specifiers carry the real file extension**: `@acorn/protocol/api.ts`,
  `@acorn/node-core/server/db/index.ts`. Intra-package imports stay relative and extensionless.
  Do *not* try to make the extension optional with an array-form `exports` target — tsc accepts it
  and rolldown does not, giving a green typecheck and a red build.
- **Every package must declare every dependency its own source touches.** pnpm resolves relative to
  the source file's package, so a consumer cannot supply it. A `.tsx` file needs `solid-js` even
  though the JSX runtime is never imported by name.
- `@acorn/*` deps live in **`devDependencies`**: `externalizeDepsPlugin()` externalizes anything in
  `dependencies`, which would emit a runtime `import '@acorn/…/x.ts'` into the Electron bundle, and
  electron-builder's devDep pruning keeps the source out of the asar.

```text
apps/desktop/           @acorn/desktop      Electron main + preload + renderer + packaging
packages/protocol/      @acorn/protocol     wire contracts (zod only; imports nothing first-party)
packages/node-core/     @acorn/node-core    server/ main/ mcp/ + Drizzle schema and migrations
packages/client-core/   @acorn/client-core  renderer runtime: shell, registries, queries, UI kit
plugins/<name>/         @acorn/plugin-<name>  20 features, each client/ server/ main/ shared/
tools/arch/             @acorn/arch-tests   the executable boundary rules
```

- `apps/desktop/src/app/` is now the *only* source in the app: `main/` (`electron.ts` entry,
  `bootstrap.ts` supervision, `serviceHost.ts`, `preload.ts`, `sessionKeyStore.ts`, plus the
  service-owned `*Wiring.ts` modules), `service/` (Electron-free runtime composition + utility
  entry), `server/` (`providers.ts`/`routes.ts` register plugin contributions; `devNode.ts` is the
  `dev:node` entry), `client/` (`index.tsx`, `App.tsx`, `CommandPalette.tsx`, `TaskView.tsx` and
  contribution activation).
- `apps/desktop/test/integration/` — tests that need the composition root's registries populated
  (providers, routes, agent profiles). They live here because importing `app/*` is legal only from
  an app; doing it from a package is a boundary violation.
- `packages/node-core/migrations/` — Drizzle migrations, co-located with `schema.ts`. The desktop
  build stages a copy into `apps/desktop/out/migrations` so the bundled service can find them.
- **`tools/arch/boundaries.test.ts` is the enforcement.** 12 rules over the package graph: nothing
  imports an app, no app→app, no relative import escapes its package, declared ⊇ used, protocol
  purity, the client/node split, the enumerated Electron surface, no package cycles, and a shrinking
  plugin→plugin ledger. It resolves bare `@acorn/*` specifiers *and* `vi.mock` paths, and it asserts
  up front that it can still see a non-trivial graph — the previous version matched only relative
  specifiers and would have passed vacuously after the split.
- Detail docs: [docs/frontend.md](./docs/frontend.md), [docs/diff-rendering.md](./docs/diff-rendering.md),
  [docs/ui-design.md](./docs/ui-design.md), [docs/electron.md](./docs/electron.md),
  [docs/api-reference.md](./docs/api-reference.md),
  [docs/authentication.md](./docs/authentication.md),
  [docs/github-integration.md](./docs/github-integration.md), [docs/data-layer.md](./docs/data-layer.md),
  [docs/caching.md](./docs/caching.md), [docs/docker.md](./docs/docker.md), and
  [docs/http-client.md](./docs/http-client.md).
- `docs/vNext/` — the target architecture this split is the first phase of. Read
  [docs/vNext/plan.md](./docs/vNext/plan.md) before starting phase work.
- `docs/` — current architecture, feature, operations, and contributor documentation. **Many topic
  docs still describe the pre-split single-package layout; trust the tree over the prose.**

## Key commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Build + launch the Electron app (`electron-vite build && electron-vite preview`); window loads `127.0.0.1:4317` |
| `pnpm dev:node` | Run just the Node server (no Electron) on `:4317` — needs Node-ABI better-sqlite3 (`pnpm rebuild:node`) |
| `pnpm --filter @acorn/desktop build` | Build main + service + MCP + preload + renderer and enforce the renderer-size budget |
| `pnpm --filter @acorn/desktop dist` | Run the gated build, then `electron-builder --mac` to produce `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | Rebuild native modules for Node, then run `vitest` |
| `pnpm --filter @acorn/desktop test:e2e` | Build/rebuild for Electron and run the Playwright desktop smoke suite |
| `pnpm db:generate` | Generate a migration and replay-check the migration chain (runs in `@acorn/node-core`) |
| `pnpm db:check` | Replay all migrations against a fresh SQLite database |
| `pnpm db:locate` | Print the absolute path to this worktree's local SQLite database |
| `pnpm db:migrate` | Apply migrations to the local SQLite DB (`apps/desktop/.acorn/acorn.sqlite`) |

## Conventions & gotchas

- **TypeScript strict; no `any`.** Match existing patterns and naming.
- **Process ownership:** new domain engines belong in the Electron-free service graph; Electron
  main is only for native UI/OS adapters and service supervision. Some service-owned modules retain
  the historical `core/main`, `plugins/*/main`, or `app/main/*Wiring.ts` paths. Classify them by
  dependency graph and runtime, not the folder label. Keep service↔main payloads serializable and
  task-addressed; use HTTP/WebSocket for renderer-facing product APIs.
- **Schema change workflow:** edit `packages/node-core/src/server/db/schema.ts` → `db:generate` →
  `db:migrate` (or just launch — `openDb` migrates on startup). After changing the bindings shape,
  update the exported `Env`/`RuntimeBindings` in `packages/node-core/src/main/bindings.ts`. (Drizzle quirk: a `NOT NULL` column on a
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
  ABI at a time (measured: Node 137, Electron 42 → 146). `pnpm dev` (Electron) needs the Electron
  ABI; `pnpm test` / `dev:node` / `db:migrate` (plain Node) need the Node ABI. Every package resolves
  to the SAME physical copy in the pnpm store, so the rebuild is a single **root** step that runs
  once before `turbo run test` — never per package, or one package rebuilds it while a sibling's
  tests are loading it. `pnpm test` self-heals (fast no-op when already correct). Afterwards run
  `pnpm run rebuild` (Electron ABI) before `pnpm dev`. `pnpm rebuild:node` switches back manually.
- **OAuth callback:** register `http://127.0.0.1:4317/auth/callback` (the `127.0.0.1` form, not
  `localhost`) on the GitHub OAuth app. See [docs/electron.md](./docs/electron.md) §4f.
- **Blob cache:** `BLOBS` is a local on-disk dir keyed by SHA (`patch:<sha>` / `filebody:<sha>`
  prefixes). The old Workers-KV-era `if (!repoRow.private)` public-only guard has been removed from
  the github plugin's `pullBlob.ts`/`prMirror.ts`; blobs are cached for all repos. See
  [docs/caching.md](./docs/caching.md).
- **Repo config trust:** executable `.acorn/config.toml` and workflow changes are hash-gated. Review
  and acknowledge the exact snapshot through `/api/tasks/:id/config-trust`; Docker matching config
  is declarative and is deliberately outside that executable-config gate.
- **Turbo caching is load-bearing and easy to get wrong.** Source-only packages have no `build`
  script, so `dependsOn: ["^build"]` resolves to nothing — hence the `topo` transit node, which is
  what makes a `node-core` edit invalidate its dependents' cached `lint`/`test`. It requires an
  **acyclic** package graph. `tsconfig.base.json` is in `globalDependencies` because otherwise
  editing the shared compiler options leaves all 25 lint tasks on a cache hit. A task that reads
  files it does not import (the boundary test) needs explicit `inputs` or it caches forever.
- **The suite is load-sensitive, and the split made it more so.** Many tests spawn real
  subprocesses — git worktrees, `bash -lc` login shells, PTYs — and 25 packages testing concurrently
  can saturate the machine until those exceed *production* timeouts (e.g. send.ts's 15s command
  cap). Symptom: a full cold `turbo run test --force` occasionally fails one package, usually
  `plugins/http` or `@acorn/node-core`, which then passes in isolation. Mitigations in place:
  `pnpm test` caps turbo concurrency at 6, and the worst offender carries an explicit `retry`. Do
  **not** "fix" a recurrence by loosening a production timeout to suit the runner — verify the
  package in isolation first, and only then treat it as real.
- **Before claiming done:** run `pnpm lint` (and `pnpm test` where relevant).
