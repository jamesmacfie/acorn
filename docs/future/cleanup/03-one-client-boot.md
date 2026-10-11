# 03: One client boot

This proposal gives the desktop renderer and the terminal client one shared start sequence, one set
of navigation commands, and client schedules that run on both hosts.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md).

## Problem

The two clients share `@acorn/client-core`, the layouts, and the kit, but each wires the shared
runtime by hand.

`apps/desktop/src/client/index.tsx` lines 138 to 154 and `apps/tui/src/main.tsx` lines 236 to 264
call the same watchers: `watchPluginChanges`, `watchTaskChanges`, `watchConnectionChanges`,
`watchProjectChanges`, `watchWorkspaceChanges`, and `watchNodeEvents`. Both also call
`startClientTelemetry` and `startDeviceConfigSync`. The desktop starts notices in
`apps/desktop/src/client/App.tsx`, and the terminal starts its own in `apps/tui/src/chrome/Shell.tsx`.

The copies have drifted. Only the desktop calls `startClientSchedules`, at `App.tsx` line 268, so
the terminal client never runs a client schedule. One visible result: a workflow run started over
the API never gets a Workflows tab in the terminal client, because the `workflows.task-runs`
schedule never runs. `startClientSchedules` in
`packages/client-core/src/host/registries/shell/schedules.ts` reads `document.hidden` and calls
`window.setInterval`, which the terminal host doesn't provide. So the terminal can't run it as
written.

The five "Go to" palette commands are written twice.
`packages/client-core/src/host/palette/navigationCommands.ts` (216 lines) and
`apps/tui/src/chrome/navigationCommands.ts` (146 lines) both register `core.goto.node`,
`core.goto.project`, `core.goto.task`, `core.goto.workspace`, and `core.goto.workspace-last`. The
desktop version navigates through the router. The terminal version navigates through its shell
model.

## Goal

A client host calls one start function for everything both hosts share. A shared command
implementation reaches the host only through a small, named interface.

## Requirements

1. Add one start function in client-core, such as `startClientRuntime({ host })`, that runs every
   shared watcher, telemetry, device config sync, client schedules, and the shared notices. It
   returns one disposer.
2. Give client schedules a host-neutral visibility signal and timer, supplied by the host through
   the platform seam in `packages/client-core/src/infra/platform/`. The terminal reports itself
   visible while its screen is up.
3. Keep host-only work in the hosts. The desktop keeps responsiveness, page facts, desktop links,
   and sound notices. The terminal keeps plugin workers, the roster, and bell notices.
4. Define a navigation interface with the operations the "Go to" commands need: open a task, a
   project, a workspace, and a Node. Each host implements it. Register the five commands once, in
   client-core, against that interface.
5. Delete `apps/tui/src/chrome/navigationCommands.ts` and the duplicated wiring in both entries.

## Out of scope

The two clients' chrome stays separate on purpose. The terminal's rail, topbar, palette, and
settings draw in cells, and this proposal doesn't merge them.

## Acceptance

- Both entries call the shared start function, and neither calls a shared watcher directly.
- In `pnpm dev:tui:agent`, a workflow run started over the API shows a Workflows tab without a
  palette start.
- The five "Go to" commands have one implementation, exercised by a test on each host.
- `pnpm test --filter=@acorn/desktop` and `pnpm test --filter=@acorn/tui` pass.
