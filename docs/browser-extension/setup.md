# Set up and troubleshoot the browser extension

This page covers installing the [browser extension](../browser-extension.md) as a development build on
macOS, pairing it with a Node, keeping its native bridge working, and removing it. It also lists every
state the sidebar shows. Read it to use the extension, or to help someone whose sidebar says something
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

1. Click the Acorn toolbar button to open the panel, then **Pair a Node**.
2. Enter the Node's HTTPS address and click **Check identity**.
3. Compare the six words with the ones the Node shows: the desktop's pairing screen, or a standalone
   Node's banner. Tick **The words match** only if they do.
4. Enter a pairing code. The desktop shows one in **Settings → Nodes → Pair another client**. A
   standalone Node prints one at start, and `kill -USR1 <pid>` prints another.

Each browser pairs on its own, so pair Chrome and Firefox separately. A Node on another computer must
advertise its address, or be reached through an SSH tunnel, as
[reaching a node from another machine](../node-distribution.md#reaching-a-node-from-another-machine) says.

## Turn on site features

- Click **Allow** beside a site in **Site access** for its buttons, sidebar handoffs, and project
  suggestions. The browser asks you first.
- To capture from a site you haven't allowed, click the Acorn toolbar button on that page, then
  capture.
- Tick **Notify me when an agent waits** for OS notifications. The browser asks you first.
- A handoff works only for a plugin running on the selected Node. The desktop's Node has GitHub, Linear,
  and Rollbar. A standalone Node has GitHub, and needs Linear and Rollbar installed as plugins.

## Repair, upgrade, and remove

- **After moving or upgrading the CLI or its Node runtime**, the launcher points at a path that's gone.
  The sidebar says the bridge stopped, and `acorn browser status` names the missing path. Run
  `acorn browser install` from the new copy, then click **Retry**. Pairings stay.
- **After reinstalling the extension**, its pairings are still in the bridge. Click **Use** on the Node
  to select it again.
- **To remove the bridge**, run `acorn browser uninstall`. It removes the registrations and launchers,
  and names each browser's bridge folder, which still holds its pairings and tokens. Delete
  `~/Library/Application Support/acorn/browser-bridge/<browser>/` to remove them.
- **Forget** in the sidebar deletes one Node's pairing from this browser. Neither forgetting nor
  deleting the folder revokes the browser's device on the Node. Another paired client can revoke it with
  `DELETE /v1/core/devices/:id` ([authentication](../authentication.md)).

## What the sidebar shows

Each failure has a next step, written in `apps/extension/src/sidebar/guidance.ts`:

| State | How it is detected | Next step shown |
| --- | --- | --- |
| Host missing | The port closes with "not found" (Chrome) or "No such native application" (Firefox) | Run `acorn browser install` |
| Host stopped | Any other close, or no reply within 10 seconds. A launcher whose runtime or entry moved exits at once | Retry, or run `acorn browser status` |
| Bad code | The Node refuses the pairing | Check the code and try again |
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
- A task another client adds doesn't appear until you choose its project again. Projects, conversations,
  and requests update live.
- Only macOS is supported, and only as development builds.
