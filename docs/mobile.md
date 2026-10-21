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
| `apps/mobile/src/client/Home.tsx` | The task list |
| `apps/mobile/src/client/TaskScreen.tsx` | One pane of a task, and the bar of its panes |

### The platform seam

The phone installs two groups of the [platform seam](./architecture/node-api.md#the-platform-seam):

- `transport` sends each request to `/node` plus the Node path, and keeps an `AbortController` per
  request ID. Events come over one `/events` socket. Frames sent before the socket opens wait in a
  queue. When the socket closes, the transport reports the Node `offline` and reconnects after 250
  milliseconds, doubling to five seconds.
- `fleet` lists the gateway's one Node from `GET /session`. The verbs that change the fleet reject
  with "Pair and manage Nodes from Acorn on your computer."

Every other group is absent, and client-core hides what needs one. There's no pairing screen, no
loaded plugins, and the page's own notifications and file inputs stand in. `platform.test.ts` lists
the groups the phone implements and the ones it leaves out.

A close with code 4401, or a `401 signed_out` from `/node` or `/session`, shows the sign-in screen.
A refused socket closes the same way as a stopped gateway, so the transport asks `GET /session` which
it was.

### Screens

The shell has three routes:

| Route | What it shows |
| --- | --- |
| `/` | Tasks grouped by workspace. Each row has the task's state: the words of the desktop rail's markers for it. |
| `/t/:taskId` | The first pane the task offers, once the built-in plugins have registered and the Node has said which of them it runs |
| `/t/:taskId/:paneId` | That pane, under a bar with **Back**, the title, and the state, over a bar of the task's panes |

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

## Limits

- Loaded plugins don't run, because the browser has no plugin custody.
- Telemetry stays off, because nothing on the phone switches it on.
- The phone tells the plugin distribution it's the desktop app, because it draws the desktop's DOM
  plugin halves.
- The built app can't load while the gateway is down, until the app caches its own files
  ([on a phone](./future/mobile/06-on-a-phone.md)). In the dev server, a cold start shows "Can't
  reach the gateway" and opens Acorn when the gateway answers.
- The gateway sends no `timeoutMs`, so a request that runs past the broker's 30-second default fails
  with `504`.

## Why

The desktop's shell holds the rail, the three-column grid, and the drawers, which are the parts a
phone has to change. The parts under the shell are what a phone shares, and they live in client-core,
so the phone gets its own shell over them, as the terminal client does
([build a mobile web app](./future/mobile/README.md#why)).
