# Mobile web app

This page covers the web app a phone opens from the account website, in `apps/mobile/src/client`. It
reaches Nodes through the account and [the phone channel](./relay/phone-channel.md). Read it before you
change the phone's shell, or when you check UI work at phone width.

## What it does

The app is a third shell over client-core, beside the desktop and [the terminal client](./tui.md). It
draws the same plugin panes the desktop draws, one at a time, with its own chrome around them.

| File | What it owns |
| --- | --- |
| `apps/mobile/src/client/main.tsx` | Installs the platform seam, then loads the app |
| `apps/mobile/src/client/platform.ts` | The seam's `transport` and `fleet` groups, over a channel for each Node |
| `apps/mobile/src/client/nodeLink.ts` | One Node's channel: when it opens, how it reconnects, and what it gives up on |
| `apps/mobile/src/client/openChannel.ts` | A ticket, a relay stream, and the handshake against the Node's pinned key |
| `apps/mobile/src/client/account.ts` | The account service, as a browser on the website calls it |
| `apps/mobile/src/client/pairedNodes.ts` | The paired Nodes and their device tokens, sealed in IndexedDB |
| `apps/mobile/src/client/pairing.ts` | Pairing with one of the account's Nodes |
| `apps/mobile/src/client/start.tsx` | The client runtime, the Node selection, and the first render |
| `apps/mobile/src/client/roster.ts` | Registers the built-in plugins in `plugins.ts` after the first frame |
| `apps/mobile/src/client/Shell.tsx` | Sign-in, the Nodes screen, the pairing dialog, and the routes |
| `apps/mobile/src/client/SignIn.tsx` | The account sign-in screen |
| `apps/mobile/src/client/Nodes.tsx` | The account's Nodes: connect, open, and forget |
| `apps/mobile/src/client/Workspaces.tsx` | The list of workspaces, or of projects with workspaces off |
| `apps/mobile/src/client/Workspace.tsx` | A workspace's dashboard and tasks, **New task**, and their bar |
| `apps/mobile/src/client/waiting.tsx` | The one attention inbox, and which workspace each row waits in |
| `apps/mobile/src/client/NeedsYou.tsx` | The list of what agents are waiting on |
| `apps/mobile/src/client/keyboardInset.ts` | Measures the on-screen keyboard |
| `apps/mobile/src/client/TaskScreen.tsx` | One pane of a task, and the bar of its panes |

### The platform seam

The phone installs two groups of the [platform seam](./architecture/node-api.md#the-platform-seam):

- `transport` sends each request over the channel of the Node it names, with that Node's device token,
  and keeps an `AbortController` per request ID. Only the Node on screen holds the event feed, which
  `interest` switches. A Node nobody has used for 30 seconds closes its channel. A channel that drops
  reports the Node `offline` and reopens after 250 milliseconds, doubling to five seconds. A foreground
  return replaces the channel at once ([coming back to the foreground](./mobile/phone-setup.md#come-back-to-the-foreground)).
- `fleet` lists the Nodes this phone is paired with. Each is its own `NodeRecord` and its own query cache,
  and a token never leaves `pairedNodes.ts`. `forget` drops this phone's record, and the Node keeps the
  device until someone revokes it from a computer, because a phone may not manage devices.

A channel gives up for four reasons, and the Node's status says which: the Node isn't the one pinned
(`identity_mismatch`), the Node's own router or the event feed refuses the token (`revoked`), the account
no longer lists the Node, or the account says the person is signed out and the sign-in screen shows. Every
other group is absent, and client-core hides what needs one. `platform.test.ts` lists the groups the phone
implements and the ones it leaves out.

### Accounts and Nodes

A phone with no account session sees **Sign in**, which sends the browser to the account's page and back
([browsers](./account-api/browsers.md)). A phone paired with no Node sees **Nodes**, the account's list.
**Connect** pairs with a Node: the phone shows three words, and a device that is already paired shows the
same words and **Allow**. The phone's own pairing dialog is the desktop's `PairingRequestDialog`, so it can
allow the next device too. The top bar's server icon opens **Nodes** from inside the app, to switch.

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

A pane's `requires` and `when` decide whether it's in the bar. The desktop's Preview pane needs the `preview` seam
group, so it never is. The phone draws a Preview pane of its own, `preview-phone`, that frames the page the Node
serves ([previews on a phone](./relay/phone-channel.md#previews)). A pane whose `when` waits on data, such as Workflows, joins the bar when its
data loads. A link to one waits for it rather than opening another pane.

Each time the Node is reachable, the phone reads its plugin roster with `refreshNodePlugins`. A host
without plugin custody has no other source for `hasHostCapability`.

The phone paints the theme and style from the Node's preferences with `applyAppearance`. It doesn't
restore or save the desktop's persisted shell state, so it never changes a layout the desktop shows.

## Use it on a phone

Open the account website on the phone and sign in. [Use the app on a phone](./mobile/phone-setup.md) has
the install, the service worker, the reconnect, and serving the app from your own host.

## Run it

`pnpm dev:mobile` starts a Vite dev server at `http://127.0.0.1:4321/app/` and forwards `/account` to a stand-in
account service. Run these first, each in its own terminal:

1. `pnpm dev:account` starts the stand-in and a relay on ports 48781 and 48782
   ([test an account service](./account-api/testing.md)). Set `ACORN_ACCOUNT_URL` for `dev:mobile` if the
   stand-in runs elsewhere.
2. A Node with **Remote access** on, such as `ACORN_ACCOUNT_URL=http://127.0.0.1:48781 pnpm dev:agent --
   --session phone`. Open Settings → Account, sign in, and turn it on.

`ACORN_MOBILE_PORT` moves the dev server, and `ACORN_MOBILE_HOST` makes it listen for another computer.
`pnpm --filter @acorn/mobile build` writes `apps/mobile/dist` and `apps/mobile/dist-sandbox`, and checks the
[startup budget](./frontend/startup-budget.md#the-phone). The dev server also serves the plugin sandbox
([try the sandbox](./mobile/phone-setup.md#try-the-sandbox)).

### Check UI work with Playwright

Drive the app in Chromium or WebKit at an iPhone's size:

1. Run the three commands above.
2. Set the viewport to 390 by 844 and open `http://127.0.0.1:4321/app/`. With the Playwright MCP tools,
   that's `browser_resize`, then `browser_navigate`.
3. Press **Sign in**. The stand-in signs in its test account at once and brings the browser back.
4. Press **Connect** on the Node. Approve the three words in the Node's own window, or with
   `POST /v1/core/pair/requests/:id` and a device token.
5. Open a task and pick panes from the bar. In a script,
   `page.getByRole('navigation', { name: 'Task panes' }).getByRole('button', { name: 'Git' })` finds
   one.
6. A pane that throws draws "This view stopped working" in a `.contribution-failed` element. Count
   those to check that a pane drew.

Watch for these traps:

- The stand-in keeps its sessions in memory, so restarting `pnpm dev:account` signs the phone out.
- A browser keeps a cookie per host, not per port, so two dev servers on `127.0.0.1` share a session.
- `performance.getEntriesByType('measure')` lists `acorn.channel.ticket`, `socket`, and `handshake`, which
  is where to read how long a connection took.

## Narrow mode and layouts

`index.html` sets `data-form-factor="narrow"`, and client-core's narrow mode and the host layouts' phone
projections do the rest ([narrow mode and layouts](./mobile/narrow-mode.md)). [The agent pane on a
phone](./mobile/agent-pane.md) covers how the shared Agents pane draws here.

## Limits

- Editing files and the dashboard editor draw but aren't promised on a phone
  ([features](./features.md#phone)). The app has no help screen to say so.
- The terminal pane has no layout recipes or run targets, and its key row has no Alt and no Ctrl with
  an arrow ([the phone's terminal pane](./terminal/client.md#the-phones-terminal-pane)).
- With the keyboard up the composer is tall and the transcript nearly disappears.
- A loaded plugin runs only when the build names a sandbox domain, and only a pane that lists `mobile` in its
  `formFactor` shows. A task pane or an overlay that paints its own iframe draws too, on the plugin's own name under
  that domain ([the phone's plugin sandbox](./mobile/plugin-sandbox.md#frames)). A project pane and a reference panel
  have no screen here. The phone keeps and trusts bundles, but it installs none, and it asks only about bundles. What a
  plugin reads and the skills it supplies are approved on the desktop
  ([the phone's plugin custody](./mobile/plugin-custody.md)). The Database, API, Rollbar, and Linear task panes list
  `mobile`, and they and the agent cost draw with no prompt when the phone's release and the Node's match. After a Node
  update the phone hasn't caught up with, each asks once.
- The API pane doesn't switch to a request's detail when you tap the request, because a plugin's panes have no way to
  report a selection. Tap **Show detail**.
- Telemetry stays off, because nothing on the phone switches it on.
- The phone tells the plugin distribution it's the desktop app, because it draws the desktop's DOM
  plugin halves.
- A phone that has never loaded the app can't open it while the website is down. Afterward the service
  worker draws the shell, which shows the Node `offline` until its channel opens.
- A phone with no account can't pair, because the key it pins comes from the account's list. Running the
  app against your own relay with no account isn't supported.
- No one has run it on a real phone yet ([the acceptance](./testing/mobile-on-a-phone.md)).
- A request that sends no `timeoutMs` fails as a timeout after 30 seconds.

## Why

The desktop's shell holds the rail, the three-column grid, and the drawers, which are the parts a
phone has to change. The parts under the shell are what a phone shares, and they live in client-core,
so the phone gets its own shell over them, as the terminal client does
([build a mobile web app](./future/mobile/README.md#why)).
