# acorn

A **local macOS agent workspace** for GitHub. acorn began as a keyboard-driven pull-request reviewer
and has grown into a workspace for driving coding agents (Claude Code, Codex, aider) against your
repositories — each task in its own git worktree, with the PR, diff, terminal, editor, notes, and the
agent all in one window.

It is a **SolidJS SPA** served by an in-process **Hono server** (`@hono/node-server`) running in the
Electron main process, backed by a **local SQLite** read-model mirror of GitHub data (better-sqlite3 +
Drizzle), an **on-disk** blob cache for diff/patch bodies, and **IndexedDB** client persistence. Log in
with GitHub and you get:

- **PR review** — searchable repo picker with pins, virtualized PR lists, and a rich detail view with
  Shiki-highlighted diffs (unified/split, word-level intra-line, inline review-comment threads,
  per-file "viewed" tracking) and write actions (merge, close, reopen, draft/ready, comment, review,
  labels, reviewers, re-run Actions).
- **Workspaces & tasks** — group your repos into workspaces; open a task (repo + branch + worktree +
  optional PR) from a PR, a Linear ticket, a Rollbar error, or from scratch. Tasks live in a left rail.
- **Panes** — a task view composes panes side by side: PR review, local-changes review, editor, notes,
  context, browser preview, Linear, and Rollbar.
- **Terminals & agents** — persistent shell/agent sessions in the task's worktree, an
  Agents panel with a live activity feed, and an MCP server that hands agents the task's context.

The Electron main process starts the Hono server on `http://127.0.0.1:4317` and points a hardened
`BrowserWindow` at it, so the SPA and API are same-origin:

- `/api/*` and `/auth/*` are handled by the server; all other paths serve the SPA shell `index.html`.
- acorn was originally a Cloudflare Worker; the migration to Electron is documented in
  [docs/electron.md](./docs/electron.md).

## Tech stack

- **Frontend:** SolidJS + `@solidjs/router`, TanStack Query (with async-storage persist),
  TanStack Virtual, Shiki for syntax highlighting, `diff` / `gitdiff-parser` for diff parsing, Monaco
  for the editor pane, xterm for terminals.
- **Backend:** Hono on `@hono/node-server` in the Electron main process; `jose` for the
  encrypted-cookie session and at-rest secret encryption; node-pty + tmux for terminal sessions.
- **Data:** local SQLite (`better-sqlite3`) via Drizzle ORM; on-disk dir for blob/patch caching;
  IndexedDB (`idb-keyval`) for client-side query persistence. All under `apps/desktop/.acorn/`.
- **Agents:** the acorn MCP server (`@modelcontextprotocol/sdk`) exposes task context to agent CLIs.
- **Build / tooling:** electron-vite (main/preload/renderer), electron-builder (macOS packaging),
  drizzle-kit, Vitest, TypeScript (strict). pnpm workspace + Turborepo monorepo.

## Monorepo layout

pnpm workspace + Turborepo. All app code lives in `apps/desktop` (`@acorn/desktop`).

The source is organised as a **plugin-oriented platform**: `core/` owns platform contracts and
services, `plugins/<name>/` owns product features, and `app/` composes the shipped application.
Each layer is split by runtime (`client` / `server` / `main` / `mcp` / `shared`). Import-boundary
tests prevent app-layer and cross-runtime leakage and keep the explicitly baselined legacy
cross-feature dependencies from growing.

```
apps/desktop/
├── src/
│   ├── core/               # platform contracts and services
│   │   ├── client/         #   shell, registries, persistence, layout, palettes, tabs,
│   │   │                   #   tasks/workspaces, settings framework, WS client
│   │   ├── server/         #   createApp() factory, session/auth/csrf middleware, sync engine,
│   │   │                   #   route + integration-provider registries, Drizzle db/
│   │   ├── main/           #   PTY/worktree primitives, bindings, server listener, MCP register
│   │   ├── mcp/            #   the acorn MCP server (stdio) — tool projection
│   │   └── shared/         #   cross-process contracts (api, ws, terminal/notes/workflow protocols)
│   ├── plugins/            # one folder per feature (client/server/main parts as needed)
│   │   ├── github/         #   PR review (PullList/PullDetail/DiffView), mirror, checks, create-PR
│   │   ├── linear/  rollbar/#   integration providers + browse/pane
│   │   ├── editor/  changes/#   editor + file finder · working-tree review + review notes
│   │   ├── notes/  memory/  #   notes pane + scopes · memory tray + proposals
│   │   ├── context/ preview/#   context tray · browser preview (WebContentsView) + browser_* tools
│   │   ├── database/ terminal/# pg browse · terminal drawer + run targets
│   │   ├── agents/ workflows/# agent roster · TOML workflows + runner
│   │   ├── profiles-{claude,codex,aider}/  onboarding/
│   │   └── …
│   ├── app/                # composition root and contribution activation
│   │   ├── main/           #   bootstrap.ts (boot order), electron.ts entry, activation modules
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
| `pnpm --filter @acorn/desktop build` | `electron-vite build` (main + preload + renderer) |
| `pnpm --filter @acorn/desktop dist` | `electron-vite build && electron-builder --mac` — produce the `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | `vitest run` |
| `pnpm --filter @acorn/desktop db:generate` | `drizzle-kit generate` — emit a migration |
| `pnpm --filter @acorn/desktop db:migrate` | `tsx scripts/migrate.ts` — apply migrations to local SQLite |

## Packaging (macOS)

```bash
pnpm --filter @acorn/desktop dist   # → apps/desktop/release/*.dmg and *.zip
```

For personal use the build is ad-hoc signed. To distribute the `.dmg` to other machines, add a
Developer ID identity + notarization in `apps/desktop/electron-builder.yml` (otherwise Gatekeeper
blocks it). `SESSION_ENC_KEY` uses `safeStorage`; packaged builds still require
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` in the environment. Since a GitHub OAuth App allows only
one callback URL, use a dedicated OAuth App for the desktop build.

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
</content>
