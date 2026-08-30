# acorn

acorn is a local macOS workspace for reviewing GitHub pull requests and running coding agents in
isolated git worktrees. The desktop app is a SolidJS renderer inside a Tauri shell. Its Node service
owns the data, integrations, worktrees, terminals, agents, workflows, and processes.

The desktop can manage the bundled local Node and any other Nodes paired to the same installation.
Every Node has its own data root and is addressed through the same HTTPS protocol.

## Product surfaces

- GitHub pull-request browsing and review: diffs, comments, reviews, labels, reviewers, checks, and
  Actions logs.
- Workspaces group projects. Tasks represent work on one project and may own a branch,
  worktree, linked PR, panes, terminals, and managed agent sessions.
- Task panes provide PR review, changes, notes, context, editor, search, preview, Docker, database,
  HTTP requests, Linear, and Rollbar surfaces.
- Agent Center and the task Agent pane manage Claude and Codex sessions, normalized transcripts,
  approvals, artifacts, usage, and search. A terminal drawer also supports shells, Aider, and raw
  provider sessions.
- Workflows run file-defined orchestration with durable run state, gates, budgets, branching, and
  joins.
- Settings covers integrations, model providers, terminals, Docker, HTTP requests, workflows,
  MCP, agent tools, nodes, plugins, security, and appearance.

## Runtime shape

A small Rust shell owns the window and supervises a Node helper process, which starts `apps/node` as
an ordinary child under the bundled Node runtime. The Node binds an HTTPS Hono server with TLS 1.3 on
loopback and an ephemeral port, then reports its endpoint, certificate fingerprint, and local device
token back. `ACORN_PORT` may pin a port for development or tests; the last successful port is kept in
`node.json` as a preference.

The renderer loads from the shell's `app://acorn` scheme. It does not hold device tokens or node
certificates and cannot connect to a Node directly. One loopback WebSocket reaches the helper's
connection broker, which performs pinned HTTPS/WebSocket connections and attaches the device bearer.

The Node serves only `/v2`: core routes under `/v2/core/*`, plugin routes under
`/v2/p/<plugin>/*`, and the authenticated event/stream socket at `/v2/events`. It serves no web
assets and has no SPA fallback.

## Repository layout

```text
apps/desktop/     Rust shell, desktop helper, renderer bridge, renderer, and packaging
apps/node/        Node composition roots, standalone entry, plugin activation, and integration tests
packages/protocol Wire contracts and route/query builders
packages/node-core Node server, auth, storage, core services, MCP, and shared registries
packages/client-core Renderer runtime, fleet state, persistence, registries, settings, and UI kit
packages/plugin-api The only host import surface for loaded plugins (node/client/ui entrypoints)
plugins/*         First-party feature packages with client/server/main/shared code as needed
tools/arch/        Import-boundary and package-graph tests
```

Every first-party package is consumed as TypeScript source through its exports map. Cross-package
imports include the real `.ts` extension. `apps/desktop` embeds the built Node artifact; it never
imports Node source.

First-party plugins ship in two tiers. Most are compiled into the composition roots. Rollbar,
Linear, model-providers, HTTP, and database ship as loaded packages: bundled with the app, installed
like third-party plugins, importing the host only through `@acorn/plugin-api`. The record of those
migrations is [docs/loaded-plugin-migration.md](./docs/loaded-plugin-migration.md).

## Development

```sh
pnpm install
pnpm rebuild:node
pnpm dev
```

Useful commands:

```sh
pnpm dev:node                              # standalone Node, no desktop window
pnpm dev:plugin <id>                       # rebuild one loaded plugin's package on every save
pnpm lint                                  # strict TypeScript and architecture checks
pnpm test                                  # native rebuild plus Vitest suites
pnpm db:check                              # replay every SQLite migration chain
pnpm --filter @acorn/desktop dist          # build, package, and verify the macOS DMG
pnpm pack:node                             # build the standalone Node tarball
```

`SESSION_ENC_KEY` (64 hexadecimal characters) is optional in development. A Node without one
generates its own. Setting it in `.env` pins a stable key across throwaway data roots. The GitHub
plugin reads `GITHUB_CLIENT_ID` when GitHub connection or import features are enabled; it does not
use a client secret.

`node-pty` is the only native module, because SQLite is the runtime's own `node:sqlite`. There is
one ABI to match: the desktop runs the Node under the same pinned runtime the tests use, so
`pnpm rebuild:node` covers both. For more information, see
[local-development.md](./docs/local-development.md).

## Documentation

[docs/README.md](./docs/README.md) is the index. It names every document under `docs/`, grouped by
kind, with a line each, and it says which document owns what.

The short version: read [architecture-overview.md](./docs/architecture-overview.md) for the runtimes
and the contracts between them, [features.md](./docs/features.md) for what the product does, and
[conventions.md](./docs/conventions.md) for where a new file goes and what it is called. If your first
task is a plugin, [plugin-map.md](./docs/plugin-map.md) is the orientation map over the whole plugin
system and is much shorter than the reference.

Design material for work that has not shipped lives under [docs/future/](./docs/future/README.md),
whose README indexes every programme and single file. Runtime contracts live in the topic docs and in
the code.
