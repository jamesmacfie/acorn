# Set up and troubleshoot the browser extension

This page covers installing the [browser extension](../browser-extension.md) as a development build on
macOS, pairing it with a Node, keeping its native bridge working, and removing it. It also describes
the panel's views and appearance, and lists every state the sidebar shows. Read it to use the extension, or to help someone whose sidebar says something
is wrong.

## What you need

- macOS, with Chrome 116 or later, or Firefox 128 or later.
- A running Node: the desktop app's, or a standalone one from [Node distribution](../node-distribution.md).
  The desktop app can stay closed when the Node runs on its own.
- The standalone `acorn` CLI, which holds the native bridge, and the root `package.json` engines' Node
  runtime.

## Install the bridge

The bridge is the CLI's native host. The browser starts it through a registration that names a
launcher script, so install it from the copy of the CLI you keep:

1. Unpack the standalone archive from `pnpm pack:node`, then run `npm ci --omit=dev` and
   `node scripts/prune-runtime.mjs` inside it, as [Node distribution](../node-distribution.md) says.
   From a checkout, run `pnpm --filter @acorn/cli build` instead.
2. In your own terminal, run `node bin/acorn.mjs browser install`, or
   `node apps/cli/bin/acorn.mjs browser install` in a checkout. An agent's task session can't run it,
   because task credentials limit the CLI to task scripts.
3. Run `acorn browser status`. Each browser should show `registered` with no problem.

[The browser host](../cli/browser-host.md) covers the files these commands write.

If the panel is already open, it shows `acorn browser install` with a **Copy** button while the bridge
is missing. It checks again every three seconds and carries on by itself once the bridge answers.
**Retry** checks at once.

## Build and load the extension

Run `pnpm --filter @acorn/extension build`. It writes `apps/extension/dist/chrome/` and
`apps/extension/dist/firefox/`, which talk to the installed bridge.

- **Chrome.** Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and
  choose `apps/extension/dist/chrome`. The ID must read `ciaaplnahgpccadenkacgipmhmpbddjo`, or the
  bridge refuses it. The extension stays installed across restarts.
- **Firefox.** Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and
  choose `apps/extension/dist/firefox/manifest.json`. Firefox removes a temporary add-on when it quits,
  so load it again after each restart. Its storage and site grants stay, because the add-on ID is fixed.

These are development builds. Neither is signed or in a browser store, and Firefox can't keep an
unsigned add-on installed.

Chrome reads registrations from the profile folder it runs on. Your everyday Chrome reads the
user-level folder that `acorn browser install` writes. A Chrome started with `--user-data-dir` reads
`<that folder>/NativeMessagingHosts` instead, so register there with
`acorn browser install --browser chrome --registry-dir <folder>/NativeMessagingHosts`.

## Pair a Node

The panel opens on pairing while no Node is paired. Later, choose **Pair another** from the Node chip's
menu, or **Pair a Node** under **Nodes** in Settings.

1. **Choose a Node.** The Node running on this Mac is listed first, as **This computer** with an **On
   this Mac** tag. The bridge found it in the same data folder `acorn` reads. Nodes this browser already
   paired show as rows with **Use**. For a Node elsewhere, click **Use another address**.
2. **Identity.** The Node on this Mac needs no check by eye: the bridge pinned the certificate from the
   Node's own files. For another address, enter its HTTPS address and click **Check identity**. Compare
   the six words with the ones the Node shows: the code panel in the desktop's **Settings → Nodes**, or
   a standalone Node's banner. Tick **The words match** only if they do, then click **Continue**.
3. **Code.** Paste a pairing code. The desktop shows one in **Settings → Nodes → Pair a browser**. A
   standalone Node prints one at start, and `kill -USR1 <pid>` prints another. The name fills in as
   **This computer** for the Node on this Mac, or the address for another. Click **Pair**.
4. **Done.** The panel names the Node it paired with. It offers **Allow** for each site where the Node's
   plugins put buttons, such as `github.com`, and a box for notifications. Both are optional, and both
   stay in Settings.

Each browser pairs on its own, so pair Chrome and Firefox separately. A Node on another computer must
advertise its address, or be reached through an SSH tunnel, as
[reaching a node from another machine](../node-distribution.md#reaching-a-node-from-another-machine) says.

## Turn on site features

- In Settings, click **Allow** beside a site under **Site access** for its buttons, sidebar handoffs,
  and project suggestions. The browser asks you first.
- To capture from a site you haven't allowed, click the Acorn toolbar button on that page, then
  capture.
- In Settings, tick **Notify me when an agent waits** for OS notifications. The browser asks you first.
- A handoff works only for a plugin running on the selected Node. The desktop's Node has GitHub, Linear,
  and Rollbar. A standalone Node has GitHub, and needs Linear and Rollbar installed as plugins.

## Repair, upgrade, and remove

- **After moving or upgrading the CLI or its Node runtime**, the launcher points at a path that's gone.
  The sidebar says the bridge stopped, and `acorn browser status` names the missing path. Run
  `acorn browser install` from the new copy, then click **Retry**. Pairings stay.
- **After reinstalling the extension**, its pairings are still in the bridge. Choose the Node from the
  Node chip's menu in the header, or click **Use** beside it in Settings.
- **To remove the bridge**, run `acorn browser uninstall`. It removes the registrations and launchers,
  and names each browser's bridge folder, which still holds its pairings and tokens. Delete
  `~/Library/Application Support/acorn/browser-bridge/<browser>/` to remove them.
- **Forget** in Settings or the Node chip's menu deletes one Node's pairing from this browser. Neither
  forgetting nor deleting the folder revokes the browser's device on the Node. Another paired client
  can revoke it with `DELETE /v1/core/devices/:id` ([authentication](../authentication.md)).

## The panel's views

The panel opens on **Home**. The header holds the Acorn mark, the selected Node as a chip with a
status dot, and the gear. The chip's menu switches Nodes, opens **Pair another**, and forgets the
selected Node. When the bridge stopped
or the Node isn't answering, one line under the header says so, with the next step from the table
below. Nothing else about Nodes or site access shows on Home.

Home lists, top to bottom:

1. **Waiting for you**, only while an agent waits on a request, across every project on the Node.
   Each request answers in place with the same buttons the conversation uses
   ([request notifications](./notifications.md#the-waiting-list)).
2. **This page**: the page's handoff offers and a handoff in progress ([handoffs](./handoffs.md)), and
   the project its site suggests, with that project's open tasks
   ([project sites](./project-sites.md#suggestions-in-the-sidebar)). Clicking a task makes it the
   current task.
3. **Agents**: every conversation in the current task, with its agent, title, state, and last line.
   A row opens the conversation. **New chat** starts another.
4. **Current task**: the task you last used. It stays whatever page shows, and **Find a task** opens
   the task search in Settings.

A conversation opens over Home, with a back arrow and the task's name above the conversation's own.
The composer's toolbar holds the three [capture](./page-capture.md) buttons, and each capture shows as
a chip in the draft.

**Settings** holds the Node list and pairing, a search across every project's open tasks, site
access, each project's sites, notifications, and appearance. Choosing a task in the search makes it
current and returns to Home.

A state shows as a coloured dot beside a word, never colour alone: green for working or online, amber
for waiting, red for failed or unreachable, and an empty ring for idle.

## Appearance

The panel loads the app's own token stylesheets, `tokens-theme.css`, `tokens-style.css`, and the
style packs, from `packages/client-core/src/infra/styles/`. It picks a theme and a style pack the way
the app does, with `data-theme` and `data-style` on the page's root element
(`apps/extension/src/sidebar/appearance.ts`).

The desktop keeps its appearance as a device preference the extension can't read, so the panel has
its own. By default it follows the system's light or dark setting with the Terminal style. Settings →
**Appearance** offers the app's 12 themes and 4 style packs. The choice is kept in `storage.local`
under `appearance` ([browser storage](./conversations.md#browser-storage)), and every open panel
follows a change made in any of them.

The Modern, Cozy, and Cute packs use the font files in `fonts.css`. A browser fetches a font only when
a rule uses it, so the Terminal style loads none of them.

## What the sidebar shows

Each failure has a next step, written in `apps/extension/src/sidebar/guidance.ts`:

| State | How it is detected | Next step shown |
| --- | --- | --- |
| Host missing | The port closes with "not found" (Chrome) or "No such native application" (Firefox) | Run `acorn browser install`, with **Copy**; the panel checks again every three seconds |
| Host stopped | Any other close, or no reply within 10 seconds. A launcher whose runtime or entry moved exits at once | Retry, or run `acorn browser status` |
| Bad code | The Node refuses the pairing | Check the code and try again |
| Node on this Mac unreadable | `node.local` fails: the data folder is held but its `node.json` or certificate doesn't read, or the Node presents another certificate | The reason, under the Node list; **Use another address** still works |
| Incompatible | The probe reports another protocol, or the broker marks the Node `incompatible` | Update whichever side is older |
| Offline | The broker reports `offline`, or a read fails | Check that the Node is running |
| Revoked | The Node answers 401 `unauthenticated` | Forget the Node and pair again |
| Identity changed | A failed read, or the sidebar opening while the Node is offline, then a probe whose fingerprint differs from the pin | Check with the Node's owner, then forget it and pair again |
| No agent can start | Every profile is uninstalled or signed out | The profile's own diagnostic |
| Conversation gone | `session.read` answers `not_found` | The draft is kept; choose another conversation |
| Conversation archived | The session row has `archivedAt` | The draft is kept; sending is off |
| Node away | The selected Node's status is neither online nor degraded | The draft is kept; sending is off until it returns |
| Request it can't answer | The host marks a request `unsupported`: a kind it doesn't answer, choices that don't read, or app access with no readable scope | The request in full, and answer it in the Acorn app |
| Answer unconfirmed | `request.resolve` fails as uncertain | The request is read again; pressing the same answer reuses its key |
| No page access | The active tab has no readable address, or the browser refuses the capture | Click the Acorn toolbar button on the page, then capture again |
| Page changed | The active tab or its address changed while a capture ran | Capture again |
| Handoff refused | The plugin's route answered an error, such as no connected account | The plugin's own message, with **Try again** |
| Nothing to hand off | The page resolved to no items | None; the page isn't an item this Node can open |

Until the bridge answers, the Node list says the paired Nodes show once it does, rather than that none
are paired.

## Limits

- In Firefox 151, the first native host the extension starts after Firefox starts can get no process.
  The sidebar says the bridge didn't answer after 10 seconds, and **Retry** connects at once. When a
  Node was already selected, the background retries by itself.
- A task another client adds doesn't appear on Home until This page shows its project again, or
  Settings opens. Projects, conversations, and requests update live.
- Only macOS is supported, and only as development builds.
