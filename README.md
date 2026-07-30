# acorn

A **local macOS agent workspace** for GitHub. acorn began as a keyboard-driven pull-request reviewer
and has grown into a workspace for driving coding agents (Claude Code, Codex, aider) against your
repositories — each task in its own git worktree, with the PR, diff, terminal, editor, notes, and the
agent all in one window.

It is a **SolidJS SPA** served by a **Hono server** (`@hono/node-server`) running in a supervised
Electron utility process, backed by a **local SQLite** read-model mirror of GitHub data
(better-sqlite3 + Drizzle), an **on-disk** blob cache for diff/patch bodies, and **IndexedDB** client
persistence. Log in with GitHub and you get:

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

Electron main supervises the utility service, waits for its Hono listener on
`http://127.0.0.1:4317`, and then points a hardened `BrowserWindow` at it, so the SPA and API are
same-origin:

- `/api/*` and `/auth/*` are handled by the server; all other paths serve the SPA shell `index.html`.
- SQLite, PTYs, worktrees, Git/process work, workflows, and reconciliation stay in the
  Electron-free utility service. Main owns only native windows/views/dialogs, `safeStorage`,
  navigation policy, and lifecycle supervision.
- A versioned, Zod-validated service protocol carries startup/lifecycle messages and narrow,
  task-addressed native capability calls. Ordinary product data remains on HTTP/WebSocket.
- acorn was originally a Cloudflare Worker; the migration to Electron is documented in
  [docs/electron.md](./docs/electron.md).

## Tech stack

- **Frontend:** SolidJS + `@solidjs/router`, TanStack Query (with async-storage persist),
  TanStack Virtual, Shiki for syntax highlighting, `diff` / `gitdiff-parser` for diff parsing, Monaco
  for the editor pane, xterm for terminals.
- **Backend:** Hono on `@hono/node-server` in a supervised Node utility process; `jose` for the
  encrypted-cookie session and at-rest secret encryption; node-pty + tmux for terminal sessions.
- **Native host:** a thin Electron main process for windows, preview views, folder selection,
  `safeStorage`, navigation policy, and utility-service supervision.
- **Data:** local SQLite (`better-sqlite3`) via Drizzle ORM; on-disk dir for blob/patch caching;
  IndexedDB (`idb-keyval`) for client-side query persistence. Server-side development data lives
  under `apps/desktop/.acorn/`; packaged builds use Electron's `userData`, and IndexedDB remains in
  the browser partition.
- **Agents:** the acorn MCP server (`@modelcontextprotocol/sdk`) exposes task context to agent CLIs.
- **Build / tooling:** electron-vite (main/service/MCP/preload/renderer), electron-builder (macOS
  packaging), drizzle-kit, Vitest, TypeScript (strict). pnpm workspace + Turborepo monorepo.

## Monorepo layout

pnpm workspace + Turborepo. All app code lives in `apps/desktop` (`@acorn/desktop`).

The source is organised as a **plugin-oriented platform**: `core/` owns platform contracts and
services, `plugins/<name>/` owns product features, and `app/` composes the shipped application.
Each layer is split by runtime (`client` / `server` / `main` / `mcp` / `shared`), while `app/` also
has the explicit `service` composition root. Import-boundary tests keep the utility graph
Electron-free, keep the native main graph out of service-owned engines, prevent app-layer and
cross-runtime leakage, and stop the explicitly baselined legacy cross-feature dependencies growing.

```
apps/desktop/
├── src/
│   ├── core/               # platform contracts and services
│   │   ├── client/         #   shell, registries, persistence, layout, palettes, tabs,
│   │   │                   #   tasks/workspaces, settings framework, WS client
│   │   ├── server/         #   createApp() factory, session/auth/csrf middleware, sync engine,
│   │   │                   #   route + integration-provider registries, Drizzle db/
│   │   ├── main/           #   mostly service-owned Node services; preload/native helpers remain
│   │   ├── mcp/            #   the acorn MCP server (stdio) — tool projection
│   │   └── shared/         #   serializable contracts, including service/native-capability RPC
│   ├── plugins/            # one folder per feature (client/server/main parts as needed)
│   │   ├── github/         #   PR review (PullList/PullDetail/DiffView), mirror, checks, create-PR
│   │   ├── linear/  rollbar/#   integration providers + browse/pane
│   │   ├── editor/  changes/#   editor + file finder · working-tree review + review notes
│   │   ├── notes/  memory/  #   scratchpad/library · memory index + proposal gate
│   │   ├── context/ preview/#   context manifest/sync · browser preview + browser_* tools
│   │   ├── database/ docker/ http/# pg browse · Docker · encrypted API requests
│   │   ├── model-providers/ terminal/# OpenAI/Anthropic adapters · terminal drawer + run targets
│   │   ├── agents/ workflows/# agent roster · TOML workflows + runner
│   │   ├── profiles-{claude,codex,aider}/  onboarding/
│   │   └── …
│   ├── app/                # composition root and contribution activation
│   │   ├── main/           #   Electron entry, native adapters, service host/supervision
│   │   ├── service/        #   Electron-free utility entry + runtime composition
│   │   ├── server/         #   providers.ts, routes.ts (register into core registries), devNode.ts
│   │   └── client/         #   index.tsx renderer entry + contribution activation
│   └── env.d.ts            # hand-written global Env (binding contract)
├── migrations/             # Drizzle-generated SQLite migrations
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
# 1. GitHub OAuth — create apps/desktop/.env with:
#    GITHUB_CLIENT_ID=...
#    GITHUB_CLIENT_SECRET=...
#    SESSION_ENC_KEY=...   (optional for Electron; required by dev:node)

# 2. Install
pnpm install

# 3. Build better-sqlite3 for Electron's ABI (once; see ABI note below)
pnpm --filter @acorn/desktop electron:rebuild

# 4. Build + launch the Electron app
pnpm dev
```

The window opens on `http://127.0.0.1:4317`; log in with GitHub. Migrations apply automatically on
startup. On a fresh Electron data root, acorn creates `SESSION_ENC_KEY` and stores it through
Electron `safeStorage`; an explicit environment value remains the recovery and `dev:node` path.

> **better-sqlite3 ABI:** the native module builds for one ABI at a time. `pnpm dev` (Electron) needs
> the Electron ABI (`electron:rebuild`); `dev:node` / `db:migrate` (plain Node) need the Node ABI
> (`node:rebuild`).

### Common scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Build + launch the Electron app (`electron-vite build && electron-vite preview`) |
| `pnpm --filter @acorn/desktop dev:node` | Run just the Node server (no Electron) on `:4317` |
| `pnpm --filter @acorn/desktop build` | Build main/service/MCP/preload/renderer and enforce the renderer budget |
| `pnpm --filter @acorn/desktop dist` | Run the gated build and produce the `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | Rebuild native modules for Node, then run the complete Vitest suite |
| `pnpm --filter @acorn/desktop test:e2e` | Build/rebuild for Electron and run desktop smoke tests |
| `pnpm --filter @acorn/desktop db:generate` | Generate a migration and replay-check the chain |
| `pnpm --filter @acorn/desktop db:check` | Replay all migrations against a fresh database |
| `pnpm db:locate` | Print the absolute path to this worktree's local SQLite database |
| `pnpm --filter @acorn/desktop db:migrate` | `tsx scripts/migrate.ts` — apply migrations to local SQLite |

## Packaging (macOS)

```bash
pnpm --filter @acorn/desktop dist   # → apps/desktop/release/*.dmg and *.zip
```

For personal use the build is ad-hoc signed. To distribute the `.dmg` to other machines, add a
Developer ID identity + notarization in `apps/desktop/electron-builder.yml` (otherwise Gatekeeper
blocks it). `SESSION_ENC_KEY` uses `safeStorage`. GitHub OAuth credentials resolve from a packaged
data-root `.env`, process environment, or the build-time fallback embedded by the release workflow.
That fallback makes installation self-contained but does not make the OAuth client secret secret;
device flow remains the long-term distribution model. Since a GitHub OAuth App allows only one
callback URL, use a dedicated OAuth App for the desktop build.

## Documentation

Detailed docs live in [`docs/`](./docs). Start with the architecture overview.

**Architecture & data**

- [architecture-overview.md](./docs/architecture-overview.md) — the keystone: one-server design, the
  lazy read-model mirror, the three cache layers, the product model, and the doc index.
- [plugins.md](./docs/plugins.md) — plugin boundaries, contribution registries, and adding features.
- [data-layer.md](./docs/data-layer.md) — the full SQLite schema table-by-table (mirror vs app-state).
- [state.md](./docs/state.md) — state tiers/scopes, startup restore descriptors, and scoped eviction.
- [api-reference.md](./docs/api-reference.md) — every `/auth/*` and `/api/*` route.
- [caching.md](./docs/caching.md) — the three cache layers and their policies.
- [github-integration.md](./docs/github-integration.md) — the REST + GraphQL clients and write actions.
- [authentication.md](./docs/authentication.md) — GitHub OAuth + encrypted-cookie session.
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
