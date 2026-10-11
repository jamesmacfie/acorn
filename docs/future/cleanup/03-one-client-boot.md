# 03: One client boot

> **Completion note, October 11, 2026.** Both client entries call `startClientRuntime()` in
> `packages/client-core/src/host/clientRuntime.ts`, and neither calls a shared watcher. The five Go to
> commands have one implementation, in `packages/client-core/src/host/registries/commands/navigationCommands.ts`.
> `pnpm lint`, the arch tests, and the `@acorn/client-core`, `@acorn/tui`, and `@acorn/desktop` suites
> pass on Node 26.8.1.
>
> What landed:
>
> - `startClientRuntime({ runtime, client, onDeviceConfig?, pluginsReady? })` wires telemetry, the
>   five Node event watchers, the plugin watcher, workflow and system notices, the task status
>   schedule, client schedules once `nodeReady()`, and device config sync. It resolves once the device
>   config file is applied, with one function that stops everything. The desktop calls it first in
>   `index.tsx` and doesn't wait. The terminal awaits it after the cache restore, so the first frame
>   draws in the configured theme.
> - Client schedules ask the platform seam whether the host is hidden (`hostHidden()` and
>   `onHostVisibilityChange()` in `infra/platform/index.ts`) and use the global `setInterval`. A host
>   can install a `visibility` group. Without one, the page's `document` answers, and with no
>   `document` the host counts as visible. The terminal installs a group that always reports visible.
> - The task status poll, `tasks.worktree-status`, moved from the desktop's `activate.ts` into the
>   shared start, so the terminal polls Git status every 10 seconds too.
> - `NavigationHost` holds what the Go to commands need from a host: the words, the task, workspace,
>   and project lists, a task's subtitle, and how to open a task, a workspace, or a project. The
>   desktop's host is `host/palette/routerNavigation.ts`, and the terminal's is
>   `apps/tui/src/chrome/navigation.ts`. Each host has a test: `routerNavigation.test.tsx` and
>   `navigation.test.ts`.
> - `apps/tui/src/chrome/navigationCommands.ts` is deleted. So are six client-core export entries that
>   only the two entries imported (`watchTaskChanges`, `watchConnectionChanges`, `watchProjectChanges`,
>   `watchWorkspaceChanges`, `watchNodeEvents`, and `telemetry/post`), and four barrel names nothing
>   else reads (`startClientSchedules`, `taskStatusScheduleContribution`, `goToGroup`, and
>   `CORE_GO_TO_GROUP`).
> - In `pnpm dev:tui:agent`, a workflow run started over the API showed a Workflows tab about four
>   seconds later, with no palette start. Go to task opened a task from the terminal's palette.
>
> Decisions and deviations:
>
> - **Switching Node isn't a host operation.** Requirement 4 lists it, but both hosts call
>   `setActiveNode()` and nothing else, so the shared command calls it directly.
> - **No host timer.** Requirement 2 asks for one. The global `setInterval` exists on both hosts, so
>   only visibility goes through the seam.
> - **`visibility` isn't a seam contract group.** The desktop bridge doesn't install it, because the
>   page answers. It sits beside `links` and `reportResponsiveness` as an optional preload member.
> - **The terminal holds the plugin watcher with `pluginsReady`.** The watcher's first pass can
>   register a loaded tree before the terminal's worker factory exists, so the terminal passes a
>   promise that settles once `fillIn` installs the factory.
> - **The terminal's watchers and notices start before the first frame,** not after it. They're
>   subscriptions, and the desktop already started them at script start. The startup closure went from
>   693,431 to 695,179 bytes against the 700,000 ceiling, because schedules and the task status poll
>   load before render.
> - **Notices and schedules start once per window.** On the desktop they used to restart with `App`
>   on every Node switch. Both follow the active Node themselves, so nothing else changes.
> - The two hosts' Go to rows differ only where the host does. The terminal's searches use `fleet`
>   scope, which falls back to the one Node it captures. Both searches reload on each keystroke
>   (`cache: false`), so the desktop's list picks up tasks that arrive while the palette is open. The
>   desktop leaves the session's captured workspace out of **Switch workspace**, which on a task
>   route is the task's workspace; before, it left out nothing there. The terminal's **Last
>   workspace** reports a workspace that's gone instead of choosing it blind.
>
> For later phases: the five watcher modules have no export entries, so a new caller goes through
> `startClientRuntime`. The terminal's startup closure has about 4.8 KB left under its ceiling.

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
`packages/client-core/src/host/palette/navigationCommands.ts` (216 lines, since renamed and deleted) and
`apps/tui/src/chrome/navigationCommands.ts` (146 lines, since deleted) both register `core.goto.node`,
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
