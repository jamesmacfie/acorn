# acorn

A **local macOS agent workspace** for GitHub. acorn began as a keyboard-driven pull-request reviewer
and has grown into a workspace for driving coding agents (Claude Code, Codex, aider) against your
repositories — each task in its own git worktree, with the PR, diff, terminal, editor, notes, and the
agent all in one window.

It is a **SolidJS SPA** bundled with the Electron app and served by Electron main from its own
`app://acorn` origin, talking to a **Node service** — a *node* — that owns everything stateful: a
**local SQLite** read-model mirror of GitHub data (better-sqlite3 + Drizzle), an **on-disk** blob
cache for diff/patch bodies, PTYs, worktrees, and Git. **IndexedDB** persists the client query cache.
Connect GitHub once from Settings → Integrations and you get:

- **PR review** — searchable repo picker with pins, virtualized PR lists, and a rich detail view with
  Shiki-highlighted diffs (unified/split, word-level intra-line, inline review-comment threads,
  per-file "viewed" tracking) and write actions (merge, close, reopen, draft/ready, comment, review,
  labels, reviewers, re-run Actions).
- **Workspaces & tasks** — group your repos into workspaces; open a task (repo + branch + worktree +
  optional PR) from a PR, a Linear ticket, a Rollbar error, or from scratch. Tasks live in a left rail.
- **Panes** — a task view composes registered panes side by side: PR review, local changes, editor,
  search, notes, context, database, browser preview, Docker, API requests, Linear, and Rollbar.
- **Terminals & agents** — persistent shell/agent sessions in the task's worktree, an
  Agent pane with chat plus a same-task session/activity sidebar, provider usage/cost detail in its
  header, and an MCP server that hands agents task-scoped context and tools.
- **Local tools** — inspect and act on task-linked Docker containers, browse/edit Postgres, and keep
  encrypted repo-scoped API requests and variables without checking secrets into the repository.

Electron main spawns the built node as an ordinary Node child process, waits for it to report where
it bound, and points a hardened `BrowserWindow` at `app://acorn`. The renderer never talks to the
node directly:

- The node is a **Hono** server over **HTTPS (TLS 1.3) on an ephemeral loopback port**, serving
  `/v2/core/*` and `/v2/p/<plugin>/*` plus a WebSocket at `/v2/events`. It serves no web assets —
  unmatched paths get a plain 404. There is no fixed port; `ACORN_PORT` pins one if you need it, and
  the last bound port is remembered in the data root's `node.json`.
- All renderer→node traffic goes through a **connection broker** in Electron main
  (`main/nodeBroker.ts`) over preload IPC, pinning the node's self-signed certificate. Deliberately
  *not* same-origin: the renderer's CSP is `connect-src 'self'`, so it needs no network permission at
  all, and one window can reach several nodes.
- There is **no login and no session**. Clients authenticate with a **device token** (`acorn_dt_…`)
  that Electron main keeps in `safeStorage`; GitHub is an ordinary stored integration credential,
  connected by the OAuth **device authorization grant**.
- SQLite, PTYs, worktrees, Git/process work, workflows, and reconciliation stay in the Electron-free
  node. Main owns only native windows/views/dialogs, `safeStorage`, navigation policy, the broker,
  and lifecycle supervision.
- A versioned, Zod-validated service protocol carries startup/lifecycle messages and narrow,
  task-addressed native capability calls. Ordinary product data remains on HTTP/WebSocket.
- acorn was originally a Cloudflare Worker; the migration to Electron is documented in
  [docs/electron.md](./docs/electron.md).

## Tech stack

- **Frontend:** SolidJS + `@solidjs/router`, TanStack Query (with async-storage persist),
  TanStack Virtual, Shiki for syntax highlighting, `diff` / `gitdiff-parser` for diff parsing, Monaco
  for the editor pane, xterm for terminals.
- **Backend:** Hono on `@hono/node-server` over a `node:https` listener, in a supervised Node child
  process; `jose` (AES-256-GCM, JWE `dir`) for at-rest secret encryption; node-pty + tmux for
  terminal sessions.
- **Native host:** a thin Electron main process for windows, preview views, folder selection,
  `safeStorage`, navigation policy, the `app://acorn` protocol handler, the connection broker, and
  node supervision.
- **Data:** local SQLite (`better-sqlite3`) via Drizzle ORM; on-disk dir for blob/patch caching;
  IndexedDB (`idb-keyval`) for client-side query persistence. Node-side development data lives
  under `apps/node/.acorn/`; packaged builds use Electron's `userData`, and IndexedDB remains in
  the renderer partition.
- **Agents:** the acorn MCP server (`@modelcontextprotocol/sdk`) exposes task context to agent CLIs.
- **Build / tooling:** vite for the node artifacts (`service`/`mcp`/`standalone`), electron-vite for
  main/preload/renderer, electron-builder (macOS packaging), drizzle-kit, Vitest, Playwright,
  TypeScript (strict). pnpm workspace + Turborepo monorepo.

## Monorepo layout

pnpm workspace + Turborepo, **26 packages**. Every first-party package is consumed as TypeScript
**source** through an `exports` map (`"./*": "./src/*"`) — no per-package build, no `.d.ts` emit, so
cross-package specifiers carry the real file extension (`@acorn/protocol/api.ts`).

The source is organised as a **plugin-oriented platform**: `packages/` owns platform contracts and
runtimes, `plugins/<name>/` owns product features, and the two apps compose the shipped application.
Each layer is split by runtime (`client` / `server` / `main` / `mcp` / `shared`).
`tools/arch/boundaries.test.ts` is the enforcement: nothing imports an app, no app→app (in
particular `apps/desktop` may never import `apps/node` source — it embeds the built artifact),
no relative import escapes its package, declared deps ⊇ used, protocol purity, the client/node
split, the enumerated Electron surface, no package cycles, and a shrinking plugin→plugin ledger.

```text
apps/
├── desktop/                @acorn/desktop — the Electron app
│   ├── src/app/main/       #   Electron entry, app:// scheme, connection broker, node supervision,
│   │                       #   preload, dialogs, safeStorage, navigation policy
│   ├── src/app/client/     #   renderer entry (index.tsx, App.tsx) + contribution activation
│   ├── e2e/                #   Playwright: desktop.smoke.spec.ts (S1–S8) + twoNode.spec.ts
│   ├── electron.vite.config.ts
│   └── electron-builder.yml
└── node/                   @acorn/node — the Electron-free node composition root
    ├── src/service/        #   runtime composition + the child-process entry (service.js)
    ├── src/server/         #   providers.ts, routes.ts, standalone.ts (the `dev:node` entry)
    ├── src/wiring/         #   node-owned glue: agent profiles, server bridges, startup security,
    │                       #   workflow/harness/context/agent-tools wiring
    └── test/integration/   #   suites that need the composition root's registries populated

packages/
├── protocol/               @acorn/protocol — wire contracts (zod only; no first-party imports)
├── node-core/              @acorn/node-core
│   ├── src/server/         #   createApp() factory, device-token auth, sync engine, route +
│   │                       #   integration-provider registries, Drizzle db/
│   ├── src/main/           #   HTTPS listener, TLS certs, data root + lock, bindings, worktrees
│   ├── src/mcp/            #   the acorn MCP server (stdio) — tool projection
│   └── migrations/         #   Drizzle-generated SQLite migrations (staged into the build)
└── client-core/            @acorn/client-core — renderer runtime: shell, registries, node/broker
                            #   client, queries, persistence, settings, palette, UI kit

plugins/                    20 product features, each client/ server/ main/ shared/ as needed
├── github/                 #   PR review (PullList/PullDetail/DiffView), mirror, checks, create-PR,
│                           #   GitHub device-flow auth
├── linear/ rollbar/        #   integration providers + browse/pane
├── editor/ changes/        #   editor + file finder · working-tree review + review notes
├── notes/ memory/          #   scratchpad/library · memory index + proposal gate
├── context/ preview/       #   context manifest/sync · browser preview + browser_* tools
├── database/ docker/ http/ #   pg browse · Docker · encrypted API requests
├── model-providers/ terminal/ #  OpenAI/Anthropic adapters · terminal drawer + run targets
├── agents/ workflows/      #   agent roster · TOML workflows + runner
└── profiles-{claude,codex,aider}/  onboarding/

tools/arch/                 @acorn/arch-tests — the executable import-boundary rules
```

## Local setup (condensed)

Full step-by-step (OAuth App creation, gotchas, scripts) is in
[docs/local-development.md](./docs/local-development.md).

Prerequisites: Node ≥ 20, pnpm 11 (`corepack enable`), and a GitHub OAuth App with **Enable Device
Flow** turned on. There is no callback URL to register and no client secret to copy.

```bash
# 1. GitHub OAuth App — create apps/desktop/.env with:
#    GITHUB_CLIENT_ID=...   (required to boot a node)
#    SESSION_ENC_KEY=...    (optional for Electron; required by dev:node)

# 2. Install
pnpm install

# 3. Build better-sqlite3 for Electron's ABI (once; see ABI note below)
pnpm run rebuild

# 4. Build + launch the Electron app
pnpm dev
```

The window opens on `app://acorn`; connect GitHub from Settings → Integrations and type the code it
shows you at github.com. Migrations apply automatically on startup. On a fresh Electron data root,
acorn creates `SESSION_ENC_KEY` and stores it through Electron `safeStorage`; an explicit environment
value remains the recovery and `dev:node` path.

> **better-sqlite3 ABI:** the native module builds for one ABI at a time. `pnpm dev` (Electron) needs
> the Electron ABI (`pnpm run rebuild`); `dev:node` / `db:migrate` (plain Node) need the Node ABI
> (`pnpm rebuild:node`).

### Common scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Build the node artifact + Electron bundles, then launch the app |
| `pnpm dev:node` | Run just the node, no Electron (`apps/node/src/server/standalone.ts`) — binds an ephemeral port and prints its endpoint, certificate and device token as one JSON line |
| `pnpm --filter @acorn/desktop build` | Build the node artifact + main/preload/renderer, stage migrations, and enforce the renderer budget |
| `pnpm dist` | Run the gated build and produce the `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | Rebuild native modules for Node, then run the complete Vitest suite |
| `pnpm --filter @acorn/desktop test:e2e` | Build/rebuild for Electron and run the 9 Playwright desktop tests |
| `pnpm db:generate` | Generate a migration and replay-check the chain |
| `pnpm db:check` | Replay all migrations against a fresh database |
| `pnpm db:locate` | Print the absolute path to this worktree's local SQLite database |
| `pnpm db:migrate` | Apply migrations to the local SQLite DB |

## Packaging (macOS)

```bash
pnpm dist   # → apps/desktop/release/*.dmg and *.zip
```

For personal use the build is ad-hoc signed. To distribute the `.dmg` to other machines, add a
Developer ID identity + notarization in `apps/desktop/electron-builder.yml` (otherwise Gatekeeper
blocks it). `SESSION_ENC_KEY` uses `safeStorage`. `GITHUB_CLIENT_ID` resolves from a packaged
data-root `.env`, process environment, or the build-time `MAIN_VITE_GITHUB_CLIENT_ID` fallback
embedded by the release workflow — a client id is not a secret, and the device flow needs nothing
else.

## Documentation

Detailed docs live in [`docs/`](./docs). Start with the architecture overview.

**Architecture & data**

- [architecture-overview.md](./docs/architecture-overview.md) — the keystone: the client/node split,
  the lazy read-model mirror, the three cache layers, the product model, and the doc index.
- [vNext/phase1-notes.md](./docs/vNext/phase1-notes.md) — what the `/v2` transport and fleet phase
  actually shipped, and where it deliberately stops short of the designs in [`docs/vNext/`](./docs/vNext).
- [plugins.md](./docs/plugins.md) — plugin boundaries, contribution registries, and adding features.
- [data-layer.md](./docs/data-layer.md) — the full SQLite schema table-by-table (mirror vs app-state).
- [state.md](./docs/state.md) — state tiers/scopes, startup restore descriptors, and scoped eviction.
- [api-reference.md](./docs/api-reference.md) — the HTTP surface route by route; its opening note
  flags what changed under `/v2`.
- [caching.md](./docs/caching.md) — the three cache layers and their policies.
- [github-integration.md](./docs/github-integration.md) — the REST + GraphQL clients and write actions.
- [authentication.md](./docs/authentication.md) — device tokens, pairing, and GitHub's device flow.
- [electron.md](./docs/electron.md) — the Cloudflare Workers → Electron migration (current runtime).

**Features & panes**

- [features.md](./docs/features.md) — a tour of what acorn can do.
- [workspaces-and-tasks.md](./docs/workspaces-and-tasks.md) — the Workspace → Task model and the rail.
- [panes.md](./docs/panes.md) — the pane system and a catalog of every pane.
- [docker.md](./docs/docker.md) — Docker source/pane, task matching, event flow, and lifecycle.
- [http-client.md](./docs/http-client.md) — encrypted API requests, variables, execution, and limits.
- [pg.md](./docs/pg.md) — the Database pane: a native Postgres viewer/editor.
- [frontend.md](./docs/frontend.md) — the SolidJS shell, routing, and state model.
- [diff-rendering.md](./docs/diff-rendering.md) — Shiki highlighting, virtualization, threads.
- [ui-design.md](./docs/ui-design.md) — UI conventions, theming, design tokens.
- [integrations.md](./docs/integrations.md) — Linear and Rollbar sources and the external-issue model.
- [command-palette-and-shortcuts.md](./docs/command-palette-and-shortcuts.md) — ⌘K, ⌘P, the keyboard model.

**Agents & automation**

- [terminal-and-agents.md](./docs/terminal-and-agents.md) — the terminal drawer, agent sessions, and monitoring.
- [mcp.md](./docs/mcp.md) — the acorn MCP server and its task-scoped tools.
- [notes-and-memory.md](./docs/notes-and-memory.md) — the notes and memory systems.
- [workflows.md](./docs/workflows.md) — run targets and the durable workflow engine.

**Setup & reference**

- [local-development.md](./docs/local-development.md) — full local setup & dev workflow.
- [testing.md](./docs/testing.md) — test suites, boundary checks, and focused validation.
- [security.md](./docs/security.md) — the loopback threat model and security invariants.
