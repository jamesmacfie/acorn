# Phase 2: boot client-core in a phone-shaped shell

Date: October 17, 2026. Status: proposed. Needs [phase 1](./01-gateway.md).

## Goal

`apps/mobile` draws a task list, opens a task, and shows one pane at a time with a bar at the bottom
to switch panes. Every built-in plugin's pane draws, through the gateway, in desktop Chrome at
390 by 844 pixels. Panes look cramped at the end of this phase. Phases 3 and 4 fix that. This phase
gives them somewhere to look.

## Starting point

- The terminal client is the model: its `main.tsx` installs the platform seam and then imports the
  rest, `apps/tui/src/roster.ts` registers the client plugins, and its `App.tsx` arranges the chrome
  ([terminal host switch](../../tui/host-switch.md)).
- `startClientRuntime` in `packages/client-core/src/host/clientRuntime.ts` starts what every client
  shares: telemetry, Node event watchers, the plugin watcher, notices, and device config sync
  ([composition](../../frontend.md#composition)).
- `packages/client-core/src/infra/platform/contract.ts` lists the seam's groups. Every group but
  `desktop` and `transport` may be absent, and a missing group hides its buttons.
- `apiClient.ts` and `wsClient.ts` in `packages/client-core/src/infra/node` send through the seam's
  `transport`. The socket client has no fallback without one.
- `packages/client-core/src/features/tasks/TaskPaneHost.tsx` draws one pane for a task.
  `paneContributions` and `paneAvailable` in `packages/client-core/src/host/registries/panes/panes.ts`
  say which panes a task offers.
- The extension builds kit components for a plain browser with Vite and Solid
  (`apps/extension/vite.config.ts`). Unlike the extension, the phone loads client-core's base and
  shell stylesheets, because it draws host layouts.

## The design

### Install the seam

The client's `main.tsx` in `apps/mobile/src/client` sets `window.acorn` before it imports anything
that reads it. The phone installs two groups:

- `transport`. `fetch` sends `fetch('/node' + path)` with the request's method, headers, and body,
  and keeps an `AbortController` per request ID for `abort`. `send`, `onFrame`, `onBytes`, and
  `onStatus` run over one `/events` socket that reconnects with backoff and reports `offline` while
  it's down.
- `fleet`. `list` answers the gateway's one Node. The verbs that change the fleet reject with "Pair
  devices from the desktop." The `pairing` group stays absent, so no pairing screen shows.

Notifications fall back to the page's own `Notification`, which the seam already does when `notify`
is absent. A test runs `seamProblems(['transport', 'fleet'])`, as `apps/tui/src/platform.test.ts`
does for the terminal.

### Register the plugins

`apps/mobile/src/client` holds a roster of the built-in client plugins, like the desktop's
`apps/desktop/src/client/plugins.ts`. Start with all 12. Phase 3 lets a pane say it doesn't work on a
phone, so the list doesn't need trimming by hand.

### Arrange the screens

The shell has three screens, each a route:

| Route | What it shows |
| --- | --- |
| `/` | Tasks grouped by workspace, from `tasksOptions` and `workspacesOptions` in `packages/client-core/src/infra/queries.ts`, drawn with kit rows |
| `/t/:taskId` | The task's first available pane |
| `/t/:taskId/:paneId` | That pane, in `TaskPaneHost` |

The task screen has a top bar with **Back**, the task's title, and its state. A bottom bar lists the
task's panes with their icons and labels, from the same data the desktop's pane switcher reads
(`packages/protocol/src/chrome/paneSwitcher.ts`). The bar scrolls sideways when the panes don't fit.
A plugin-provided pane switcher stays a desktop feature.

The shell sets `env(safe-area-inset-*)` padding on both bars and uses `100dvh`, so the bars clear the
notch and the home indicator.

### Run it

`pnpm dev:mobile` starts the gateway and a Vite dev server that forwards `/node` and `/events` to it.
Document how to drive it with Playwright at an iPhone viewport, so an agent can check its own UI
work. Add a startup budget for the app's first screen, the way the desktop has one
([startup budget](../../frontend/startup-budget.md)).

## Steps

1. Add the Vite and Solid build for `apps/mobile/src/client`, and the `dev:mobile` script.
2. Install the seam and its contract test.
3. Add the roster, `startClientRuntime`, and one query client per Node.
4. Draw the three screens.
5. Add the architecture entries. An app that imports a plugin's `contract/` needs its import edge
   listed in `tools/arch/boundaries.test.ts`.

## Acceptance

- At 390 by 844 pixels in desktop Chrome, the task list loads, a task opens, and every built-in pane
  draws something other than an error.
- Stopping the gateway shows the offline state, and starting it again recovers without a reload.
- A screenshot of every built-in pane goes in the pull request, as the before pictures for phases 3
  and 4.
