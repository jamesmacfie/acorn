# CLI architecture and runtime boundaries

Status: proposal, 2026-09-27. Surveyed against commit `e0445287`.

## Source to consumer

One command has this path:

```text
argv, stdin, and selected Node
  -> CLI parser and typed command input
  -> device custody and pinned broker
  -> authenticated Node /v1 route
  -> core service or owning plugin
  -> durable row, event ledger, file, or external effect
  -> bounded response projected as CLI output
```

The Node resolves the task's project, worktree, configuration trust, agent profile, workflow
definition, and plugin availability. The CLI does not read core or plugin SQLite, load a plugin Node
module, spawn an agent itself, or resolve a database URL. That rule lets another UI use `/v1` without
reproducing command behavior. It also keeps the [Node and shell boundary](../../architecture-overview.md)
intact.

`apps/cli/` is the proposed home for the parser, command handlers, output projection, and an
executable entry. A thin launcher routes no subcommand to the existing `apps/tui` entry and a
subcommand to `apps/cli`. The CLI entry must not statically import the renderer, Solid, terminal
input modes, client query cache, or client plugin bundles. Place reusable custody and local-Node
discovery in a published `@acorn/custody` path, not a deep import from `apps/tui`. The terminal host
can then consume the extracted seam without changing what it draws. Keep protocol wire types and
route builders in their owning protocol or plugin contracts, per [conventions](../../conventions.md).

## Identity and Node selection

The default Node is the local data root selected by the terminal client's existing rule:
`ACORN_DATA_DIR`, then the desktop data root when present, then the development root. `--node NAME`
selects exactly one remembered Node ID or label; `--node https://HOST:PORT` uses the existing
fingerprint comparison and pairing flow on an interactive terminal. An ambiguous name fails with the
matching IDs. A non-interactive process cannot pair for the first time: it reports the missing
pairing action and exits without a partial write. Read commands may later add explicit `--all-nodes`
fan-out, but no mutation fans out implicitly.

The CLI and TUI on the same machine should use one fleet and device-token store. Reuse
`FleetStore`, `deviceTokens`, `NodeBroker`, `probeNode`, and `pairWithNode` from `@acorn/custody`.
Tokens stay in custody, at the existing 0600 file mode, and never appear in JSON, logs, process
arguments, shell completion, or plugin handler input. The broker enforces the Node's certificate pin,
protocol probe, bearer, reconnect behavior, and request timeout. A changed fingerprint is a hard
error, not a reason to pair silently. See [security](../../security.md) and
[API versioning](../../api-reference.md#versioning).

A piped resource carries `nodeId`. If `--node` names another Node, the receiver refuses it. This
prevents a task ID copied from one fleet member from being treated as a task on another. Explicit
`--node` remains the normal choice in a script that stores only IDs.

## Process lifetime

`acorn` without a subcommand retains the TUI's attach-or-start behavior and stops only a Node it
started. A short CLI command does not borrow that lifetime rule. Phase 1 attaches to a running Node;
an absent Node gets a stable connection error. Phase 2 adds explicit `acorn node start --background`,
`status`, and `stop`, with its own persistent ownership record. A task, agent, or workflow command
exits when its request completes and never stops a Node with live work. A desktop-owned or
operator-owned standalone Node must not become CLI-owned merely because the CLI attached to it.

The standalone Node already has a root lock and a shutdown drain. Use those as the source of truth
for liveness. A background launcher needs a private startup handshake that conveys the first device
token to custody without putting it in a world-readable log. Securely redirect stdout and stderr,
retain an operator-readable log path, and bound startup and stop waits. The exact handshake transport
can be chosen in Phase 2 after inspecting the standalone entry, but the acceptance cases in that
phase are required. Do not treat `spawn(...).unref()` plus a PID file as a completed supervisor.

## Distribution and compatibility

The repository builds `apps/tui/dist/main.js`, but `scripts/pack-node.mjs` currently stages the
standalone service and its runtime dependencies, not a TUI or CLI executable. Phase 1 must make a
runnable `acorn` entry available from a checkout and from the intended standalone distribution.
Decide the artifact layout in that phase and test the extracted artifact, not only workspace module
resolution. The future [bundle design](../bundle.md) is background reading; the actual pack script
is the release fact.

Node protocol major and baseline checks apply before requests. Within a major, Node wire changes are
additive. CLI JSON has its own `apiVersion` because it is a public script contract, not a dump of a
Node response that can change whenever a renderer needs a field. Preserve unknown response fields
at the transport boundary but emit only documented CLI fields. Schema snapshots and examples belong
with the CLI implementation. A separate UI can call `/v1` directly through its own paired device;
the CLI is not the only programmatic entrypoint.

## Verify before building

- Read `apps/tui/src/node/open.ts`, `attach.ts`, `paths.ts`, `supervise.ts`, and `platform.ts` together;
  the shared seam must preserve attach, pairing, and ownership rules.
- Read `packages/custody/src/broker/nodeBroker.ts`, `packages/custody/src/broker/nodePairing.ts`,
  `packages/node-core/src/server/middleware/idempotency.ts`, and the Node service entries.
- Check `apps/tui/vite.config.ts`, `apps/tui/scripts/check-startup-graph.mjs`, and
  `scripts/pack-node.mjs` before choosing the launcher and bundle split.
