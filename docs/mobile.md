# Mobile web app

This page covers the web app a phone opens through the [mobile gateway](./security/mobile-gateway.md),
in `apps/mobile/src/client`. Read it before you change the phone's shell, or when you check UI work at
phone width.

## What it does

The app is a third shell over client-core, beside the desktop and [the terminal client](./tui.md). It
draws the same plugin panes the desktop draws, one at a time, with its own chrome around them.

| File | What it owns |
| --- | --- |
| `apps/mobile/src/client/main.tsx` | Installs the platform seam, then loads the app |
| `apps/mobile/src/client/platform.ts` | The seam's `transport` and `fleet` groups, over the gateway |
| `apps/mobile/src/client/start.tsx` | The client runtime, the Node selection, and the first render |
| `apps/mobile/src/client/roster.ts` | Registers the built-in plugins in `plugins.ts` after the first frame |
| `apps/mobile/src/client/Shell.tsx` | Sign-in, the wait for the gateway, and the routes |
| `apps/mobile/src/client/Workspaces.tsx` | The list of workspaces, or of projects with workspaces off |
| `apps/mobile/src/client/Workspace.tsx` | A workspace's dashboard and tasks, **New task**, and their bar |
| `apps/mobile/src/client/waiting.tsx` | The one attention inbox, and which workspace each row waits in |
| `apps/mobile/src/client/NeedsYou.tsx` | The list of what agents are waiting on |
| `apps/mobile/src/client/keyboardInset.ts` | Measures the on-screen keyboard |
| `apps/mobile/src/client/TaskScreen.tsx` | One pane of a task, and the bar of its panes |

### The platform seam

The phone installs two groups of the [platform seam](./architecture/node-api.md#the-platform-seam):

- `transport` sends each request to `/node` plus the Node path, and keeps an `AbortController` per
  request ID. Events come over one `/events` socket. Frames sent before the socket opens wait in a
  queue. When the socket closes, the transport reports the Node `offline` and reconnects after 250
  milliseconds, doubling to five seconds. When the page becomes visible again, it replaces the socket at
  once ([coming back to the foreground](./mobile/phone-setup.md#come-back-to-the-foreground)).
- `fleet` lists the gateway's one Node from `GET /session`. The verbs that change the fleet reject
  with "Pair and manage Nodes from Acorn on your computer."

Every other group is absent, and client-core hides what needs one. There's no pairing screen, no
loaded plugins, and the page's own notifications and file inputs stand in. `platform.test.ts` lists
the groups the phone implements and the ones it leaves out.

A close with code 4401, or a `401 signed_out` from `/node` or `/session`, shows the sign-in screen.
A refused socket closes the same way as a stopped gateway, so the transport asks `GET /session` which
it was.

### Screens

| Route | What it shows |
| --- | --- |
| `/` | The workspaces in the Node's order, or the visible projects with `core.workspaces` off, from the desktop picker's `pickerWorkspaces`. Each row has its `WorkspaceIdentity`, its name, its task count, and how many items wait in it. What waits on the Node itself is listed under them. |
| `/w/:workspaceId` | The workspace's dashboard, which is empty |
| `/w/:workspaceId/tasks` | **Needs you** for the workspace, then its tasks grouped by its visible projects. Each task row has the task's state: the words of the desktop rail's markers for it. |
| `/t/:taskId` | The first pane the task offers, once the built-in plugins have registered and the Node has said which of them it runs |
| `/t/:taskId/:paneId` | That pane, under a bar with **Back**, the title, and the state, over a bar of the task's panes |

The two workspace routes share a bottom bar of **Dashboard** and **Tasks**, drawn like the task's bar
of panes. **Tasks** carries a marker while something waits in the workspace, so someone on the empty
dashboard can see it. The top bar's title is the workspace's name, and on `/` it's **Workspaces** or
**Projects**, from `createWorkspaceWords`. A task route names no workspace, so a link from a
notification works too. **Back** from a task goes to the tasks of the workspace its project is in,
from `workspaceForProject`.

**Needs you** is the desktop bell's inbox (`createAttentionInbox`). `WaitingProvider` makes it once
for every screen, after the built-in plugins register, because it reads the registered sources once.
A row waits in the workspace of its task's project, or else of its project. A row that names neither
is about the Node, and `/` lists it. The list hides while nothing waits. A row names the agent and what
it asks, then the task and the session's state. A tap runs the source's own target handler, which
selects the session and shows its pane in the task's layout, and then opens that pane. The phone reads
the pane the handler showed from the layout, so a workflow gate opens Workflows the same way. The
phone never persists that layout.

**New task** is in the top bar of a workspace's tasks. It opens the desktop's `TaskDraftDialog` with the
workspace's visible projects, as the desktop offers the active workspace's, in a full-screen sheet
([dialogs](./ui-design/overlays.md#dialogs)), and opens the task it makes.

The pane is the contribution's own component inside a `ContributionBoundary`, the way the terminal
client draws one. The phone doesn't use `TaskPaneHost`, which draws a row of panes from the task's
saved layout, with the desktop's switcher and pin and close buttons. The route says which pane shows,
so the phone never writes a layout. The bottom bar draws the desktop switcher's `RailTab` buttons,
from the same panes and markers, with the label under the icon. It scrolls sideways when the panes
don't fit.

A pane's `requires` and `when` decide whether it's in the bar. Preview needs the `preview` seam
group, so it never is. A pane whose `when` waits on data, such as Workflows, joins the bar when its
data loads. A link to one waits for it rather than opening another pane.

Each time the Node is reachable, the phone reads its plugin roster with `refreshNodePlugins`. A host
without plugin custody has no other source for `hasHostCapability`.

The phone paints the theme and style from the Node's preferences with `applyAppearance`. It doesn't
restore or save the desktop's persisted shell state, so it never changes a layout the desktop shows.

## Use it on a phone

`acorn mobile` serves the app, and `tailscale serve` gives it the HTTPS name a phone needs. [Use the app on a
phone](./mobile/phone-setup.md) has the steps, the install, the service worker, and the reconnect.

## Run it

`pnpm dev:mobile` starts the gateway and a Vite dev server at `http://127.0.0.1:4321`, which forwards
`/node`, `/session`, and `/events` to it. The gateway prints a sign-in code. The first time it meets a
Node, it asks for a pairing code in the same terminal. Set `ACORN_MOBILE_PORT` and
`ACORN_MOBILE_GATEWAY_PORT` to move the two servers, and pass gateway flags after `--`, such as
`pnpm dev:mobile -- --node studio`.

`pnpm --filter @acorn/mobile build` writes `apps/mobile/dist` and checks the
[startup budget](./frontend/startup-budget.md#the-phone). `pnpm dev:mobile:gateway` serves that build
at `http://127.0.0.1:4320`.

### Check UI work with Playwright

Drive the app in Chromium at an iPhone's size:

1. Run `pnpm dev:mobile` and note the sign-in code.
2. Set the viewport to 390 by 844 and open `http://127.0.0.1:4321`. With the Playwright MCP tools,
   that's `browser_resize`, then `browser_navigate`.
3. Type the code into **Sign-in code** and press Enter. The page reloads signed in, and the session
   lasts across gateway restarts.
4. Open a task and pick panes from the bar. In a script,
   `page.getByRole('navigation', { name: 'Task panes' }).getByRole('button', { name: 'Git' })` finds
   one.
5. A pane that throws draws "This view stopped working" in a `.contribution-failed` element. Count
   those to check that a pane drew.

Watch for these traps:

- Vite reloads the page when its dev server restarts, and stopping the gateway stops `pnpm
  dev:mobile`. To check the offline state, build the app, run `pnpm dev:mobile:gateway`, and stop
  and start that.
- A browser keeps a cookie per host, not per port, so a session from the dev server works on the
  gateway's own port too.
- `kill -USR1 PID` prints another sign-in code. The gateway prints its PID with the first one.

## Narrow mode

`index.html` sets `data-form-factor="narrow"` on `<html>`, so the attribute holds before the first
paint. Client-core does the rest, and no plugin changes
([the narrow sheet](./ui-design/tokens.md#the-narrow-sheet)):

- Controls and rows take touch sizes, and text inputs draw at 16px so iOS Safari doesn't zoom into them.
- Controls that appear on hover are always shown.
- `startClientRuntime` installs `installLongPressMenu`, which sends the `contextmenu` event a
  right-click sends after a finger rests for half a second. iOS sends none of its own, and Android's
  is dropped when ours arrived first, so a menu opens once.
- A pane that lists only `desktop` in its `formFactor`, such as Preview, isn't offered
  ([form factor](./panes/contributions.md#form-factor)).
- The rail data a plugin's tree reads carries `formFactor: 'narrow'`.

The phone's own bars are sized in `mobile.css`.

### The keyboard

A phone's browser keeps the page the same size when the on-screen keyboard opens and shrinks only the
visual viewport. `trackKeyboardInset` measures the difference and keeps `--keyboard-inset` and
`data-keyboard` on `<html>`. The shell's height subtracts the inset, a dialog sheet ends above it, and
the bar of panes is hidden while it's up, so the pane gets every line. A pane reads no window and is
only given less room. To check it in Playwright, replace `window.visualViewport` with an event target in
an init script, set its `height`, and dispatch `resize`.

## The conversation

[The agent pane on a phone](./mobile/agent-pane.md) covers how the shared Agents pane draws here.

## Narrow layouts

Each host layout draws a phone projection from the same component it draws the desktop with, choosing
by `formFactor()` once per mount ([pane layouts](./panes/layout.md#named-layouts)):

- `list-detail` and the kit's `ListDetail` show one column at a time. A pane's `selection` shows the
  detail, **Back** returns to the list, and **Show detail** goes forward again
  ([narrow `list-detail`](./panes/layout.md#narrow-list-detail)).
- `document-over-frame`, `frame-beside-document`, and `stack-split` fill the pane with their first
  region. **Show panel** opens the second in a full-screen `Drawer`.
- On a phone every `Drawer` is a sheet over the whole screen, because there are no rails or task footer
  to sit between.
- `single`, `header-body-footer`, `wizard`, and `tabs` don't change. The tab strip already scrolls
  sideways.

## Limits

- Typing in a terminal, editing files, and the dashboard editor draw but aren't promised on a phone
  ([features](./features.md#phone)). The app has no help screen to say so.
- With the keyboard up the composer is tall and the transcript nearly disappears.
- Loaded plugins don't run, because the browser has no plugin custody.
- Telemetry stays off, because nothing on the phone switches it on.
- The phone tells the plugin distribution it's the desktop app, because it draws the desktop's DOM
  plugin halves.
- A phone that has never loaded the app can't open it while the gateway is down. Afterward the service
  worker draws the shell, which says "Can't reach the gateway" until the gateway answers.
- No one has run it on a real phone yet ([the acceptance](./testing/mobile-on-a-phone.md)).
- The gateway sends no `timeoutMs`, so a request that runs past the broker's 30-second default fails
  with `504`.

## Why

The desktop's shell holds the rail, the three-column grid, and the drawers, which are the parts a
phone has to change. The parts under the shell are what a phone shares, and they live in client-core,
so the phone gets its own shell over them, as the terminal client does
([build a mobile web app](./future/mobile/README.md#why)).
