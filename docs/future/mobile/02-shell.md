# Phase 2: boot client-core in a phone-shaped shell

Date: October 17, 2026. Status: shipped October 21, 2026. Needs [phase 1](./01-gateway.md).

## Completion note

Completed October 21, 2026. [Mobile web app](../../mobile.md) owns the shipped behavior. This page
keeps what the later phases need.

### What landed

- `apps/mobile/src/client`: the platform seam in `platform.ts` with its contract test, the built-in
  plugins in `roster.ts` and `plugins.ts`, the composition root in `start.tsx`, and the screens: a
  sign-in screen, the task list, and a task with one pane and a bar of its panes.
- `pnpm dev:mobile`, which starts the gateway behind a Vite dev server at `http://127.0.0.1:4321`.
- `pnpm --filter @acorn/mobile build`, with a startup budget in
  `apps/mobile/scripts/check-startup-budget.mjs`. The first screen loads 482,910 B of scripts and
  121,692 B of styles, against ceilings of 507,000 B and 128,000 B.
- `GET /session` on the gateway, which names the Node to a signed-in phone and answers
  `401 signed_out` to one without a session.
- In client-core, `bodyForFetch` moved to its own module, `infra/node/fetchBody.ts`, so the seam can
  use it before anything reads the seam. `applyAppearance` is exported from `appStartup.ts`, and the
  desktop's restore calls the same function as before.
- `docs/mobile.md`, with how to drive the app with Playwright at 390 by 844, and updates to the
  gateway page, the startup budget page, `docs/README.md`, and `AGENTS.md`.

The acceptance checks passed in Chromium at 390 by 844, against a throwaway standalone Node. The
task list loaded and tasks opened. Every pane a phone offers drew without a failed contribution:
Agent, Git, Workflows, Apps, Notes, Context, Editor, Docker, and the GitHub, GitLab, and Bitbucket
change request panes. Preview never shows, because it requires the `preview` seam group. Some panes
needed seeded data: a workflow run in the plugin's database, an app written with `AppStore`, a
labelled `alpine` container, and projects with GitHub, GitLab, and Bitbucket remotes. Stopping the
gateway showed **Offline** in the top bar, and starting it again cleared it without a reload.
Revoking the session showed the sign-in screen within a second. The built app ran through the
gateway under its `script-src 'self'` policy.

The screenshots, the before pictures for phases 3 and 4, are 16 PNG files in
`/Users/jamesmacfie/Source/acorn/apps/node/.acorn/worktrees/jamesmacfie-acorn-phase-2-shell/references/mobile-phase-2/`,
a folder git ignores. They aren't committed.

### Decisions and deviations

- **The pane draws outside `TaskPaneHost`.** That host draws a row of panes from the task's saved
  layout, which the desktop shares through the `task_layouts` preference, with the desktop's switcher
  and its pin and close buttons. The phone draws the contribution's component in a
  `ContributionBoundary`, as the terminal client's `PaneBody` does, and the route names the pane. The
  phone never writes a layout.
- **Fifteen plugins, not 12.** The desktop registers 15 client plugins, and 12 of them contribute a
  task pane. The phone registers the same 15.
- **A sign-in screen.** This page didn't list one, but a phone has no other way to get the cookie.
- **`GET /session` lists the fleet.** Phase 1 left this route to this phase. The list doesn't wait
  for the socket, it carries the gateway's name for the Node, and the transport uses it to tell a
  refused socket from a stopped gateway.
- **The phone reads the Node's plugin roster itself.** Without plugin custody, the plugin
  distribution never reads a Node, so every pane with `requires: { plugin }` read as unavailable.
  `start.tsx` calls `refreshNodePlugins` each time the Node is reachable.
- **No persisted shell state.** The phone doesn't register the core state slices or run
  `createAppStartupRestore`, so it can't write a phone's choices into preferences the desktop
  restores. It paints the theme and style with `applyAppearance`.
- **`app: 'desktop'`.** `PluginClient` is `'desktop'` or `'terminal'`, and the value only decides
  which loaded plugins run. The phone draws the desktop's DOM plugin halves and runs no loaded plugin.
  A `'mobile'` value changes the manifest contract, so it waits for
  [plugins on the phone](../mobile-plugin/README.md).
- **Telemetry stays off.** The desktop and the terminal turn it on from the Node's preference. The
  phone doesn't.
- **Only `/t/:taskId` picks a pane,** once the plugins have registered and the Node has listed its
  plugins. A named pane the task doesn't offer yet waits, because Workflows and Apps offer themselves
  only after their own data loads.
- **The bottom bar reuses `RailTab`** with its label as `sublabel`, sized in `mobile.css`. A task's
  state is the legend of its rail markers (`taskState.ts`).
- **The proxy is spelled out.** Vite's shorthand rewrites `Host`, and a `/node` prefix also catches
  `/node_modules`. The desktop's Vite config ignores `**/.acorn/**` when watching, which matches every
  file in an Acorn worktree, so the phone's config leaves that out.
- **Client-core's entrypoint cap** in `tools/arch/boundaries.test.ts` went from 208 to 209 for
  `infra/node/fetchBody.ts`.
- **Only `ToastHost` is mounted.** The desktop's other hosts aren't: link previews, reference panels,
  the overlay and drawer slots, and the confirmation before quitting. A pane action that opens one does
  nothing on a phone. None of the screens checked here needed one.

### What later phases need

- **Phase 3.** Preview is already off the phone's pane bar through its seam gate. Set the form
  factor before the first paint in `main.tsx` or `index.html`. The bar's sizes are in `mobile.css`,
  outside the token packs.
- **Phase 4.** The screenshots show each `list-detail` pane split down the middle at 390 pixels.
- **Phase 5.** Add **Needs you** to `Home.tsx`. A sheet for `TaskDraftDialog` needs a host the phone
  doesn't mount. The gateway forwards no `timeoutMs`, so a request past the broker's 30-second default
  fails with `504`.
- **Phase 6.** `nodeReconnect` on the fleet group reconnects at once and resets the backoff, for the
  return to the foreground. Reconnects back off from 250 milliseconds to five seconds. `fleet.list`
  asks the gateway, so a relaunch can't draw before the gateway answers. The `Secure` cookie works on
  `http://127.0.0.1` in Chromium. Safari is unchecked.
- **Checking it.** The first gateway start against a Node asks for a pairing code on the terminal.
  From an agent shell, drive it with `/usr/bin/expect`. Stopping the gateway under `pnpm dev:mobile`
  stops Vite too, and Vite reloads the page when it returns, so check outages against
  `pnpm dev:mobile:gateway` and a build.

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
