# Ticket 07: Terminal-owned client state

Date: 2026-09-21. Status: not started. Prerequisites: 06.
Read [context](./context.md), F05 in [findings](./findings.md), and
[session-source decisions](./target-architecture.md#shared-client-contracts).

## Outcome

Core consumes session summaries and actions without fetching Terminal routes or owning full PTY rows.

## Work

- Add the narrow disposable, node-scoped session-source registration through the existing compiled
  client plugin context. Core aggregates summaries for send pickers, quit concerns, and navigation.
- Move session fetch/invalidation, full rows, active-terminal state, and the PTY attention adapter into
  Terminal. Register its projection and actions during client activation and dispose them on shutdown.
- Remove `sendToAgent` from TaskBridge and duplicate Terminal route literals from client-core. Move
  consumers to source actions while preserving all three submission modes and explicit node identity.
- Split true task/archive/worktree/run-target protocol types from Terminal session and PTY payload types.
  Core owns envelope dispatch; Terminal owns its channel payload and handler. Update WS/facade consumers.
- Extend architecture tests to reject executable named plugin route literals in shared runtime packages.
  Allow generic namespace construction and test fixtures, not per-plugin production exceptions.

## Acceptance

Terminal drawer, send picker, attention, quit concerns, and focus work on desktop and terminal hosts.
Two Nodes with the same session ID do not share state. Switching Nodes, scope eviction, restart,
plugin disposal, and failed refresh do not expose stale rows or actions. An empty source is supported.
Run `pnpm lint`, architecture/client/Terminal tests, and isolated real-window checks. Confirm core's
production graph has neither Terminal contract imports nor Terminal-specific HTTP literals.

## Verify before building

Inspect all imports of core's session store and task bridge, including tab navigation and agent rail
markers. Keep raw PTY transport authority inside its host/plugin boundary; summaries do not carry handles.
