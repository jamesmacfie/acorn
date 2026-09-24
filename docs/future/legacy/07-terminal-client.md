# Ticket 07: Terminal-owned client state

Date: 2026-09-21. Status: implemented 2026-09-23. Prerequisites: 06.
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

The Terminal drawer works in the desktop host. Both hosts consume Terminal's session-source
summaries, send action, attention, quit concerns, and focus intent where they have a receiver.
The TUI does not draw the `drawer` slot or a Terminal session pane; its session-source actions remain
available to shared clients, but visual session selection and PTY input are outside this ticket's
terminal host contract (see [tui.md](../../tui.md#what-a-plugin-loses-here)).
Two Nodes with the same session ID do not share state. Switching Nodes, scope eviction, restart,
plugin disposal, and failed refresh do not expose stale rows or actions. An empty source is supported.
Run `pnpm lint`, architecture/client/Terminal tests, and isolated real-window checks. Confirm core's
production graph has neither Terminal contract imports nor Terminal-specific HTTP literals.

## Verify before building

Inspect all imports of core's session store and task bridge, including tab navigation and agent rail
markers. Keep raw PTY transport authority inside its host/plugin boundary; summaries do not carry handles.

## Implementation and evidence

- The compiled client context now registers disposable session sources. Terminal owns its full roster,
  active tab, fetch, invalidation, send and focus actions, PTY attention adapter, and PTY WebSocket
  payload handler. Core aggregates node-scoped summaries for both hosts, task navigation, send
  pickers, setup markers, and quit concerns. Selected rows carry a registration version so plugin
  reload cannot redirect an old action to a new source. The reference shortcut still offers the
  managed-agent handler first. The send action preserves `now`, `after-ready`, and `draft`.
- Terminal replaces its attention snapshots after every successful roster fetch, including an empty
  fetch. Failed refresh, Node switch, scope eviction, and plugin disposal clear the relevant state.
  Terminal validates PTY JSON payloads; core retains WebSocket envelope dispatch and generic
  `term:status` chrome invalidation.
- The desktop mounts Terminal's drawer. The TUI deliberately does not mount host `drawer` slots, so
  this implementation does not claim a visual Terminal session or send picker in that host. Ticket
  13 records the remaining UI acceptance gap separately from the shared session-source contract.
- True task, archive, worktree, run-target, and shared activity types moved to focused protocol
  files. Terminal session and PTY payload types live in Terminal. The architecture test rejects
  executable named-plugin route literals in shared runtime packages. A source scan found no
  production Terminal contract import or Terminal HTTP route literal in client-core or node-core.

Verification on 2026-09-23:

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed: 34/34 package lint tasks, including TUI TypeScript compilation. |
| Client-core suite | Passed: 211 files, 1,718 tests. A later focused session-source run passed 5/5 tests after the reload guard test was added. |
| Plugin API suite | Passed: 3 files, 12 tests; surface snapshot updated for the ownership move. |
| Desktop scoped-eviction and TaskBridge tests | Passed: 2 files, 9 tests. |
| Terminal suite | 19/20 files and 118/119 tests passed. The live `node-pty` delivery test fails at `posix_spawnp failed` before delivery code runs, both inside the sandbox and with unsandboxed execution. |
| Architecture suite | 63/65 tests passed, including the new route guard. The two failures at the time were the palette host invoking a command in `paletteView.ts` and a Findings test for a migration that ticket 09 later removed. |
| Isolated Tauri window | Desktop asset and debug-binary builds passed, Node service reached ready. The window showed “Acorn could not start — Importing a module script failed” after the Vite dev server reported failed module fetches. The session was stopped. Terminal drawer interaction could not be checked in that window. |
| `git diff --check` | Passed. |
