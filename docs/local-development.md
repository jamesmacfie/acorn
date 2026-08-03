# Local development

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)), and its transport is now `/v2` over HTTPS with device tokens (see
> [vNext/phase1-notes.md](./vNext/phase1-notes.md) for what shipped). `pnpm dev` builds + launches the
> Electron app; secrets live in `apps/desktop/.env`; migrations apply on startup or via
> `pnpm db:migrate`.

Clone → running → GitHub-connected runbook for acorn. For the system design behind it, see
[architecture-overview.md](./architecture-overview.md).

## Prerequisites

- **Node** ≥ 20 (developed on 24).
- **pnpm 11** — the repo pins `packageManager: pnpm@11.0.0`. Run `corepack enable` to get
  the pinned version automatically.
- A **GitHub OAuth App** with **Device Flow** enabled.
- **macOS** to produce a packaged build (`pnpm dist`); `pnpm dev` runs anywhere Electron does.

## 1. Create a GitHub OAuth App

acorn connects to GitHub with the **OAuth device authorization grant** (RFC 8628), so there is no
callback URL to register and no client secret to exchange — the grant is issued against the
`client_id` alone.

- GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.
- Name it whatever you like. The **Homepage URL** is unused; GitHub still requires a value.
- Leave the **Authorization callback URL** alone — nothing redirects back to acorn.
- Tick **Enable Device Flow**. Without it GitHub refuses to issue a device code.
- Copy the **Client ID**. You do not need a client secret.

The node binds an **ephemeral** loopback port, so there is nothing origin-shaped to keep stable
(`packages/node-core/src/main/serverConfig.ts`: `configuredPort()` returns undefined unless you set
`ACORN_PORT`, and the last bound port is remembered in the data root's `node.json`). The device flow
requests the scopes `repo read:org read:user`.

## 2. Configure local secrets — `apps/desktop/.env`

Dev secrets live in `apps/desktop/.env`, loaded by Electron main (`process.loadEnvFile`) before it
spawns the node, and separately by `dev:node`. Packaged Electron builds use `safeStorage`
for `SESSION_ENC_KEY`; main resolves that key and passes it to the node through its controlled
environment. `GITHUB_CLIENT_ID` resolves from `<userData>/.env`, then process environment, then the
`MAIN_VITE_GITHUB_CLIENT_ID` fallback embedded by release CI.

```bash
cp apps/desktop/.env.example apps/desktop/.env
```

For `dev:node`, generate the secret-box key. `SESSION_ENC_KEY` must be **exactly 64 hex characters**
(32 bytes / 256-bit) — it is the AES-256-GCM (JWE `dir`) key that encrypts secrets **at rest**
(integration credentials, HTTP-client fields), and
`packages/node-core/src/server/secretBox.ts` rejects anything not matching `^[0-9a-fA-F]{64}$`:

```bash
openssl rand -hex 32
```

Then fill `apps/desktop/.env`:

```
GITHUB_CLIENT_ID=<from your OAuth App; required — a node refuses to boot without it>
GITHUB_CLIENT_SECRET=<optional; the device flow needs no secret and nothing reads this>
SESSION_ENC_KEY=<the 64-hex-char openssl output; optional for Electron, required by dev:node>
```

> **The name outlived the cookie.** `SESSION_ENC_KEY` was the key for the sealed session cookie.
> There is no cookie and no session any more, but the key stayed: it is what integration credentials
> are encrypted with, so losing it strands every stored provider token
> (`packages/node-core/src/main/bindings.ts`).

`.env` is gitignored — **never commit it**.

## 3. Install and run

```bash
# From the repo root
pnpm install

# better-sqlite3 and node-pty are native: build them against Electron's ABI before
# `pnpm dev` (and back to the Node ABI with `pnpm rebuild:node` if you use dev:node / db:migrate).
pnpm run rebuild

# Build the node artifact + Electron bundles, then launch. Migrations apply automatically
# on startup (openDb); the SQLite DB and blob cache live under apps/node/.acorn/.
pnpm dev
```

The Electron window opens on `app://acorn` — the renderer is bundled with the app and served by
Electron main's protocol handler (`apps/desktop/src/app/main/appScheme.ts`), not by the node. Connect
GitHub from **Settings → Integrations**: acorn shows a code, you type it at github.com, and it polls
until the grant lands.

> **No login gate.** There are no accounts, sessions or cookies. The renderer reaches the node
> through the connection broker in Electron main (`main/nodeBroker.ts`) over preload IPC, holding a
> device token and pinning the node's self-signed certificate — so there is nothing to log in to and
> nothing origin-shaped to keep stable.

> **Desktop-only features.** The terminal drawer, agent sessions, run targets, and workflows need the
> Electron main-process engines, and `capabilities()`
> (`packages/client-core/src/capabilities.ts`) is what every surface keys off to degrade with a visible
> reason where they are absent. A `dev:node` node has no UI of its own — it serves no web assets — so
> it is a node for a client to pair with, not a browser build.

## Local data — `apps/node/.acorn/`

In development, all node-side state lives under `apps/node/.acorn/` (gitignored), resolved from the
module's own location rather than `process.cwd()`
(`packages/node-core/src/main/serverPaths.ts` — Electron uses the same `devDataDir()`). Packaged
builds use Electron's `app.getPath('userData')`:

- `core.sqlite` (+ WAL files) — the Drizzle/SQLite database: the GitHub mirror *and* acorn's own
  app-state (workspaces, tasks, review notes, prefs, encrypted integration tokens, the memory
  index).
- `node.json` / `node.lock` — the node's identity (`nodeId`, protocol version, last bound port) and
  its exclusive lock. Opening the root is what makes a directory a node.
- `tls/` — the self-signed certificate and key the HTTPS listener presents, and clients pin.
- `blobs/` — immutable file/patch bodies keyed by SHA (the `BLOBS` cache).
- `worktrees/` — per-task git worktrees created by the terminal/agent features.
- `logs/` — the node's log directory.
- `notes/` and `memory-proposals/` — file-backed working notes and pending human-gated memories.
- `internal-token` / `active-identity` — mode-`0600` loopback-child credential and its explicit
  current identity binding.
- `session.key` — present once `safeStorage` has minted or migrated `SESSION_ENC_KEY`
  (`apps/desktop/src/app/main/sessionKeyStore.ts`).

> **A V1 root is refused, not upgraded.** `openDataRoot` throws if the directory holds V1's
> `acorn.sqlite` rather than quietly opening a second database beside it
> (`packages/node-core/src/main/dataRoot.ts`) — vNext never migrates V1 data. Point it at a fresh
> root; the old files stay untouched.

The mirror tables are disposable (they re-sync from GitHub on demand), but the same database file
holds app-state acorn owns — so deleting `.acorn/` wholesale resets *everything*: workspaces,
tasks, notes, review notes, and connected integrations, not just cached GitHub data. Client-side,
the TanStack Query cache persists in the app origin's IndexedDB and rebuilds itself on the next
fetch.

## Common scripts

Run from the repo root via Turborepo, or per-package with `--filter`. The db scripts belong to
`@acorn/node-core`; the root aliases delegate to it.

| Script | What it does |
| --- | --- |
| `pnpm dev` | `build:service && electron-vite build && check:runtime-syntax && electron-vite preview` — build the node artifact + Electron bundles, then launch the app |
| `pnpm dev:node` | `pnpm --filter @acorn/node dev:node` — run just the node (no Electron) from `src/server/standalone.ts`. Needs the Node ABI, `SESSION_ENC_KEY` and `GITHUB_CLIENT_ID`. Binds an ephemeral port, takes its data root from `ACORN_DATA_DIR` or the dev root, and prints one JSON line: `{nodeId, endpoint, fingerprint, certPem, deviceToken}` |
| `pnpm --filter @acorn/desktop build` | Build the node artifact (`service.js`/`mcp.js`/`standalone.js` from `apps/node`), then Electron main + preload + renderer, stage `packages/node-core/migrations` into `out/migrations`, and enforce the renderer budget |
| `pnpm dist` | Run the gated build and package the `.dmg`/`.zip` |
| `pnpm --filter @acorn/desktop electron:dev` | `electron-vite dev` — watch mode for main/preload; the renderer comes from the last-built `dist/client`, never the vite dev server |
| `pnpm run rebuild` / `pnpm rebuild:node` | switch the native ABI of better-sqlite3 + node-pty (Electron ↔ Node) |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | Rebuild native modules for Node, then run the complete Vitest suite |
| `pnpm --filter @acorn/desktop test:e2e` | Rebuild the node artifact, build, rebuild native modules for the Electron ABI, then run the 9 Playwright tests (`e2e/desktop.smoke.spec.ts` S1–S8 + `e2e/twoNode.spec.ts`) |
| `pnpm db:generate` | `drizzle-kit generate` — emit a migration from the schema, then replay the full chain on a fresh throwaway DB (`scripts/check-migrations.ts`) |
| `pnpm db:check` | Just the fresh-DB migration replay — catches the NOT-NULL table-rebuild quirk below |
| `pnpm db:locate` | Print the absolute path to this worktree's local SQLite database |
| `pnpm db:migrate` | `tsx scripts/migrate.ts` — apply migrations to local SQLite |

`pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm test` all proxy through Turborepo at the root.
`dev`, `build` and `test:e2e` each run `build:service` first, because staging can only detect a
node artifact that is *missing*, never one that is stale.

`dev:node` and `db:migrate` run under plain Node, so they need the **Node ABI**
(`pnpm rebuild:node`) — after either, run `pnpm run rebuild` again before `pnpm dev`. `db:migrate`
targets `apps/node/.acorn/core.sqlite` by default; set `ACORN_DB_PATH` to point it elsewhere.
A wrong-ABI better-sqlite3 no longer dies with a bare `NODE_MODULE_VERSION` stack: `openDb`
(`packages/node-core/src/main/bindings.ts`) catches the native load error and rethrows naming the right rebuild
script for the runtime you're in.

> **Why acorn still uses `better-sqlite3`.** A `node:sqlite` spike confirmed FTS5
> (porter) and transactions fine under the bundled Node, but Drizzle ships **no** `node:sqlite`
> driver (even latest 0.45.2 — only better-sqlite3/bun/durable/expo/op/proxy), so adopting it means
> the generic `sqlite-proxy` driver or dropping Drizzle. And `node-pty` keeps the dual-ABI rebuild
> alive regardless, so the payoff is halved. **Both native deps still need the ABI dance above.**

## Database migrations

The schema lives in `packages/node-core/src/server/db/schema.ts` (Drizzle, SQLite dialect). To change it:

```bash
# 1. Edit packages/node-core/src/server/db/schema.ts

# 2. Generate the SQL migration into packages/node-core/migrations/
pnpm db:generate

# 3. Apply it to the local SQLite DB (also applied automatically on app startup)
pnpm db:migrate
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
`app.getPath('userData')` (dev keeps the repo-local `apps/node/.acorn/`). `SESSION_ENC_KEY` is
generated or migrated into `safeStorage`. A packaged `GITHUB_CLIENT_ID` can come from
`<userData>/.env`, process environment, or the release build's embedded `MAIN_VITE_GITHUB_CLIENT_ID`
fallback — a client id is not a secret, and the device flow needs nothing else.
