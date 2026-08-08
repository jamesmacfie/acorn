# acorn

acorn is a local macOS workspace for reviewing GitHub pull requests and running coding agents in
isolated git worktrees. The desktop app is a SolidJS renderer inside Electron. Its Electron-free
Node service owns the data, integrations, worktrees, terminals, agents, workflows, and processes.

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

Electron main starts `apps/node` as an ordinary Node child process. The Node binds an HTTPS Hono
server with TLS 1.3 on loopback and an ephemeral port, then reports its endpoint, certificate
fingerprint, and local device token to Electron main. `ACORN_PORT` may pin a port for development or
tests; the last successful port is kept in `node.json` as a preference.

The renderer loads from Electron's `app://acorn` scheme. It does not hold device tokens or node
certificates and cannot connect to a Node directly. Preload IPC calls the connection broker in
Electron main, which performs pinned HTTPS/WebSocket connections and attaches the device bearer.

The Node serves only `/v2`: core routes under `/v2/core/*`, plugin routes under
`/v2/p/<plugin>/*`, and the authenticated event/stream socket at `/v2/events`. It serves no web
assets and has no SPA fallback.

## Repository layout

```text
apps/desktop/     Electron main, preload, renderer, packaging, and Playwright e2e
apps/node/        Node composition roots, standalone entry, plugin activation, and integration tests
packages/protocol Wire contracts and route/query builders
packages/node-core Node server, auth, storage, core services, MCP, and shared registries
packages/client-core Renderer runtime, fleet state, persistence, registries, settings, and UI kit
plugins/*         First-party feature packages with client/server/main/shared code as needed
tools/arch/        Import-boundary and package-graph tests
```

Every first-party package is consumed as TypeScript source through its exports map. Cross-package
imports include the real `.ts` extension. `apps/desktop` embeds the built Node artifact; it never
imports Node source.

## Development

```sh
pnpm install
pnpm run rebuild
pnpm dev
```

Useful commands:

```sh
pnpm dev:node                              # standalone Node, no Electron window
pnpm lint                                  # strict TypeScript and architecture checks
pnpm test                                  # native rebuild plus Vitest suites
pnpm --filter @acorn/desktop test:e2e      # builds the service artifact, then Playwright
pnpm db:check                              # replay every SQLite migration chain
pnpm --filter @acorn/desktop dist          # build and package the macOS app
pnpm pack:node                             # build the standalone Node tarball
```

The Node needs an exactly 64-character hexadecimal `SESSION_ENC_KEY` in development. The optional
GitHub plugin reads `GITHUB_CLIENT_ID` when GitHub connection/import features are enabled; it does not
use a client secret. Native modules are ABI-specific: use `pnpm rebuild:node` for
plain Node commands and `pnpm run rebuild` for Electron, as documented in
[local-development.md](./docs/local-development.md).

## Documentation

Start with [architecture-overview.md](./docs/architecture-overview.md), then use the topic docs:

- [features.md](./docs/features.md) — shipped product surfaces.
- [frontend.md](./docs/frontend.md) and [state.md](./docs/state.md) — renderer composition and state ownership.
- [authentication.md](./docs/authentication.md) and [security.md](./docs/security.md) — device auth and boundaries.
- [api-reference.md](./docs/api-reference.md) and [data-layer.md](./docs/data-layer.md) — Node API and storage.
- [plugins.md](./docs/plugins.md) and [agent-tools.md](./docs/agent-tools.md) — extension seams and tool projection.
- [local-development.md](./docs/local-development.md), [testing.md](./docs/testing.md), and
  [node-distribution.md](./docs/node-distribution.md) — build, test, and distribution workflows.

The completed project-model migration record is [docs/legacy/projects/README.md](./docs/legacy/projects/README.md).
Current runtime contracts live in the parent `docs/` tree and the code.
