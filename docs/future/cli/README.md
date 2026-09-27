# Acorn command-line interface

Status: proposal, 2026-09-27. Surveyed against commit `e0445287`. No CLI subcommands described here have shipped.

This programme adds scriptable commands to `acorn` while keeping the no-argument terminal client.
The Node remains the owner of tasks, agents, workflows, plugin data, authentication, and execution.
The command-line interface (CLI) is another client of `/v1`. It returns stable JSON for programs and
readable text for people. A caller can start work, disconnect, and later inspect or follow it.

The end-to-end acceptance case is: start or attach to a persistent Node, list workspaces and
projects, add a local project to a workspace, create a task in that project, start a managed agent
with a prompt, exit the CLI without stopping the work, inspect its state from a second process, and
launch a published workflow that can use contributed step kinds. A loaded third-party plugin can add
a typed command under its own name without acquiring a new route or permission bypass.

## Read order and ownership

| File | Owns |
| --- | --- |
| [architecture.md](./architecture.md) | Runtime boundaries, identity, transport, packaging, and process lifetime. |
| [interface.md](./interface.md) | Command grammar, JSON and JSON Lines, stdin, errors, and worked scripts. |
| [phase-1-host.md](./phase-1-host.md) | A headless executable, shared custody, packaged entry, and workspace, project, and other read commands. |
| [phase-2-service.md](./phase-2-service.md) | Explicit persistent local Node start, status, and stop. |
| [workspace-and-project-commands.md](./workspace-and-project-commands.md) | Phase 3 workspace/project CRUD, configuration, membership, and provider mappings. |
| [phase-3-tasks-and-agents.md](./phase-3-tasks-and-agents.md) | Workspace and project writes, task creation, managed sessions, prompts, events, and waits. |
| [phase-4-workflows.md](./phase-4-workflows.md) | Workflow discovery, start, run and step inspection, waits, and the merged run view. |
| [phase-5-plugin-commands.md](./phase-5-plugin-commands.md) | Loaded and compiled plugin command declarations and dispatch. |
| [verification.md](./verification.md) | Cross-phase fixtures, test gates, security checks, and release acceptance. |
| [references.md](./references.md) | Repository contracts and external CLI precedents. |
| [refused.md](./refused.md) | Alternatives considered and the conditions that would reopen them. |

Each phase is a bounded handoff. Finish its acceptance and update the owning reference docs before
starting the next one. The phases may land as one implementation series; each phase need not be a
separately released product. `architecture.md` and `interface.md` are the shared contract and should
be reviewed before implementation changes their decisions.

## Dependency order

```text
Phase 1: headless client, workspace/project discovery, and read path
  -> Phase 2: persistent local service
  -> Phase 3: tasks and managed agents
  -> Phase 4: workflows and monitoring
  -> Phase 5: third-party plugin commands
```

Phase 1 can be tested against a Node started by the desktop or the standalone entry. Phase 2 makes
the whole journey available when no host is already running. Phase 5 follows the first-party
commands so its declaration and output rules have concrete examples.

## Architectural facts to preserve

- Core owns workspace and project identity. A workspace groups local projects, and a project has an
  absolute path on the Node host. The CLI must preserve that host path distinction when the caller
  connects remotely. See [workspaces and tasks](../../workspaces-and-tasks.md).
- Core owns task identity and lifecycle. A task belongs to one project; a branch task receives a
  worktree only when execution first needs one. See [workspaces and tasks](../../workspaces-and-tasks.md).
- The Agents plugin owns managed sessions, turns, requests, and a durable event ledger. A raw terminal
  provider session is a PTY, not a substitute for a structured agent command. See
  [managed agents](../../managed-agents.md) and [terminal sessions](../../terminal.md).
- The Workflows plugin owns definitions, immutable published revisions, run and step records, gates,
  retry, and recovery. The CLI starts definitions by ID and never executes a graph locally. See
  [workflows](../../workflows.md) and [execution](../../workflows/execution.md).
- A loaded plugin owns its own `/v1/p/<id>` routes. Its Node worker receives only declared
  permissions. A client plugin command must stay inside that model. See the [plugin map](../../plugin-map.md).
- The desktop and terminal clients present the same Node state in different hosts. The CLI has no
  renderer, pane, modal, or selected row. See the [terminal client](../../tui.md) and
  [command palette](../../command-palette-and-shortcuts.md).

## Documentation handoff

This folder holds proposed behavior. When a phase ships, move its final command contract to an
owning reference page under `docs/` and update [the documentation index](../../README.md). Keep this
folder as the decision and delivery record until the whole acceptance case passes. Update examples
and file paths if implementation changes them; do not leave a future document describing a different
CLI from the one that shipped.

## Verify before building

- Recheck [architecture overview](../../architecture-overview.md), [API reference](../../api-reference.md),
  and [node distribution](../../node-distribution.md). They own behavior over this proposal.
- Inspect `apps/tui/src/main.tsx`, `apps/tui/src/node/open.ts`, `packages/custody/src/broker/`,
  `apps/node/src/entries/standalone.ts`, and `scripts/pack-node.mjs` before moving entrypoints.
- Run `pnpm lint` and the relevant tests named in [verification.md](./verification.md) for every phase.
