# Phase 1: a headless host and read path

Status: proposed implementation handoff, 2026-09-27. Depends on [architecture](./architecture.md)
and [interface](./interface.md). No CLI subcommands have shipped.

## Outcome and rationale

An installed `acorn` can run a command without opening the terminal client. It attaches to an
already-running Node through the same paired device custody as the terminal client. A script can
discover workspaces and projects, then inspect tasks and loaded capabilities. This phase establishes
the public output contract before any write command relies on it. It can be tested with the desktop
or standalone Node already running; persistent CLI-owned startup belongs to Phase 2.

The no-argument `acorn` path still opens the terminal UI. `acorn --help` and help at each built-in
command level work offline and without a TTY. A Node command must not load the renderer, switch the
terminal to raw mode, or wait for keyboard input. A missing Node returns a useful connection error.

## Work to deliver

1. Choose a thin binary/launcher and a Node-only `apps/cli` package. Extract only the reusable
   custody and local Node discovery parts from `apps/tui/src/node/` into a published seam. Keep
   TUI-specific ownership and terminal lifecycle in the TUI. Build a dependency graph test that
   rejects renderer, Solid, and client-plugin imports from the CLI entry.
2. Parse the global Node and output options before dispatch. Resolve a single Node from its stable
   ID or an unambiguous remembered label. Reuse the fleet store, tokens, pairing, pinned TLS, broker,
   and protocol compatibility checks. A non-interactive unpaired process fails with an instruction
   to pair interactively. No command leaks bearer or pairing material.
3. Implement `node info`, `workspace list|show`, `project list|show`, `task list|show`, and
   `plugin list`. Workspace `show` may be implemented by finding an ID in `GET /v1/core/workspaces`;
   no separate server route exists today. The workspace list includes its project membership.
   Project list comes from `GET /v1/core/projects`; filter by `workspaceId` in the client only if
   the response is complete, and name that choice in help. The project resource includes its Node
   path, workspace ID, visibility, and detected VCS facet. Core currently has task list routes for
   active and archived tasks, but no `GET /tasks/:id`; `task show` should select by ID from both
   lists or add a guarded core detail route if that becomes necessary. Task list must document
   active versus archived behavior and avoid presenting an active-only route as all history.
4. Define named, versioned output projections for `Workspace`, `Project`, `Task`, and plugin
   availability. In `text`, provide a compact table with IDs accessible, plus `--no-header` for
   script-friendly text where useful. In `json`, emit exactly one value and newline. Refuse
   `--output jsonl` for a non-stream command unless it has a specified one-record-per-item meaning.
   Publish the error and exit-code table before Phase 3 writes are added.
5. Make the CLI runnable from a checkout and the intended extracted standalone artifact. The current
   `scripts/pack-node.mjs` packages a Node service, MCP entry, and runtime dependencies, not an
   `acorn` CLI binary. Decide whether one archive or an adjacent archive supplies the executable,
   and adjust packaging, entrypoints, and smoke tests accordingly. Do not assume a workspace-only
   `node apps/cli/...` invocation proves distribution works.

## Data and boundary details

Workspaces are top-level named groups. The current workspace route returns an array with embedded
project references. Projects are Node-host local folders, each with one `workspaceId`; the project
route returns `{ projects: [...] }`. The CLI output is a stable projection of those responses, not
their raw shapes. A project path from a remote Node is on that Node host. It is not a path to open
on the CLI caller's machine. External provider project links are a different resource; do not merge
them into `project list` as if they were local project rows.

The client must expose absent, disconnected, unpaired, fingerprint-changed, auth-rejected, and
protocol-incompatible Nodes as distinct failures. An explicit `--node` takes precedence over the
local default. A piped typed resource from another `nodeId` must fail before a write in later phases.

## Tests and acceptance

- An integration fixture with two remembered Nodes proves ID selection, ambiguous label rejection,
  and no accidental cross-Node fallback. A changed certificate pin fails closed.
- Against a seeded Node, `workspace list` shows the default workspace and project membership;
  `project list --workspace ID` returns only local projects in it; `show` by an unknown ID exits
  nonzero with `not_found`; task and plugin reads match owner routes.
- `--output json` parses as one value with no stdout noise for success; a failed command writes
  structured diagnostics only to stderr and does not expose tokens. Validate output against
  committed JSON schemas and golden examples.
- A headless process with stdin redirected and no TTY completes `--help` and a read; the terminal
  renderer is absent from its import graph. With no arguments and a TTY, the terminal UI still boots.
- Extract the staged distribution into a clean temporary folder outside the monorepo. Its `acorn`
  entry returns help and reads a seeded standalone Node with no workspace module resolution.

## Verify before building

- Inspect `apps/tui/src/main.tsx`, `apps/tui/src/node/`, `apps/tui/vite.config.ts`,
  `packages/custody/src/`, `apps/node/src/entries/standalone.ts`, and `scripts/pack-node.mjs`.
- Inspect `packages/node-core/src/server/routes/projects/workspaces.ts`, `projects.ts`, and
  `tasks.ts`, plus `packages/protocol/src/api.ts`, for current shapes and filters.
- After implementation run `pnpm lint`, relevant package and architecture tests, and the extracted
  artifact smoke in [verification](./verification.md).
