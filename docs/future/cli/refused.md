# Decisions not to build into the CLI

Status: proposal, 2026-09-27. Surveyed against commit `e0445287`.

## Running domain code in the CLI

Refused. The Node owns worktrees, agent processes, workflow persistence, plugin databases, and
configuration trust. A CLI-side executor would split lifecycle and authority between clients. Reopen
only if a domain capability is moved out of the Node for every host, with a replacement recovery and
security model. A faster CLI invocation alone is not that reason.

## Reusing every command-palette row

Refused. An `openPane`, `surfaceAction`, modal, or selected-row action requires a mounted client UI.
The palette's `runNodeAction` is one closed UI verb, not a schema for inputs and outputs. A CLI command
may call the same Node service as a palette command, but it needs its own discoverable typed contract.
See [command palette](../../command-palette-and-shortcuts.md).

## Exposing every MCP agent tool

Refused. MCP tools run under task-scoped internal credentials, signed session identity, and the
owner's tool ceiling. A paired device is a different principal with broader authority. Projecting
the whole tool registry into CLI commands would obscure the actor and could bypass a tool's intended
session requirement. A concrete tool may gain a CLI command only through its owning plugin or core
service with a reviewed device route. See [agent tools](../../agent-tools.md) and [MCP](../../mcp.md).

## Treating a workflow step as a shell command

Refused. A step handler receives rendered bindings, frozen inputs, budget, task, run lineage, and
retry context. A CLI call cannot manufacture that context safely. A plugin can offer a separate CLI
command over the same underlying service. Reopen only if the workflow runner publishes a supported
one-step admission contract that preserves those invariants.

## PATH-discovered plugin executables and arbitrary API proxy

Refused. Acorn's loaded Node plugins already have installation, trust, permission-scoped workers,
route namespaces, and lifecycle. A `PATH` executable or `acorn api POST /v1/p/...` as the extension
contract would bypass typed discovery and expose routes never intended for scripts. Keep the command
catalog explicit and owner-stamped. An expert diagnostic HTTP command could be designed separately,
with its own authority and output rules, if a real need remains.

## Implicit multi-Node mutations and parallel agents in one checkout

Refused. Nodes do not share a transaction, and repeated managed sessions on one task can write the
same worktree. A script may select Nodes and tasks explicitly. A workflow can create child tasks with
separate worktrees for independent agents. Reopen a bulk start command only with a declared isolation
policy, partial-result model, and repeat-safe identity per child.

## Silent local daemon startup

Refused. A headless `task list` must not leave a service running and a `workflow start` must not own a
service it will stop on exit. Use explicit `acorn node start --background` or attach to a Node another
host already owns. Reopen automatic startup only after service ownership, logs, upgrades, and stop
behavior are proven across desktop, TUI, standalone, and CLI launchers.

## Verify before building

- Re-read `docs/command-palette-and-shortcuts.md`, `docs/agent-tools.md`, `docs/workflows.md`, and
  `docs/tui.md` before expanding any of these boundaries.
- Inspect `packages/node-core/src/server/middleware/requireUser.ts` and plugin route guards before
  giving a new command a device or task-scoped entrypoint.
