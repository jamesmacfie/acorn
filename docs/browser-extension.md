# Browser extension

This page covers the Acorn extension for Chrome and Firefox and the native bridge it reaches a Node
through: who owns what, the native messaging contract, pairing, and the states the sidebar shows.
Read it before you change the extension, the bridge, or an operation between them.

Topic pages:

- [Native messaging](./browser-extension/native-messaging.md): the frames, every operation and event
  between the background and the native host, and the frame limits.
- [Set up and troubleshoot](./browser-extension/setup.md): install the bridge and the development
  builds, pair, repair or remove them, appearance, and what each sidebar state means.
- [Sidebar navigation](./browser-extension/navigation.md): Home, a task with its tabs, and a
  conversation, with the top bar, **Back**, and the strip under the bars at each.
- [Agent conversations](./browser-extension/conversations.md): the agent operations, change hints,
  the conversation window, send retries, and browser storage.
- [The conversation view](./browser-extension/transcript.md): the transcript, folded tool calls, the
  state line with **Stop**, and the message box's keys.
- [Page capture](./browser-extension/page-capture.md): the link, selection, and screenshot captures,
  the page's **Add to Acorn chat** entry, page access, sending them, and the attachment operations.
- [Ask Acorn about an element](./browser-extension/element-picker.md): the element picker and its checks.
- [Handoffs](./browser-extension/handoffs.md): the task chip on websites, the handoff card, the
  panel's verbs and its `acorn://` links, and the operations that resolve a page and create a linked
  task.
- [Workflows](./browser-extension/workflows.md): starting a workflow, and a task's Runs tab.
- [Plugin panels](./browser-extension/plugin-panels.md): a plugin's read-only view of the sidebar's
  task, its tab, and the operation that reads it.
- [Pages matched to tasks](./browser-extension/task-pages.md): the `tasks.pages` read, the app
  addresses plugins publish, matching the page to its task in the browser, Home's **This page**
  section, and the branch marker on a local app.
- [Project sites](./browser-extension/project-sites.md): the web addresses tied to a project, the
  sidebar's project suggestions and overrides, and the site operations.
- [Request notifications](./browser-extension/notifications.md): the toolbar badge, the waiting list,
  and opt-in OS notifications for requests agents are waiting on.

## What runs where

Three pieces carry a request from the sidebar to a Node:

1. The extension, `apps/extension/`. Its sidebar page (`src/sidebar/`) is at one of three levels: Home,
   about the page beside it and the Node's tasks, one task with its panes as tabs, or one conversation
   inside a task. Settings, behind the gear, is one page of Nodes, sites, notifications, and appearance
   ([sidebar navigation](./browser-extension/navigation.md)).
   Its background (`src/background/`) owns the one native port. Chrome runs the
   background as a module service worker and shows the page in its side panel. Firefox runs it as a
   background script and shows the page in its sidebar. `src/browser.ts` types the slice of the
   extension API both use.
2. The native host, `apps/cli/src/browser/`. The browser starts it as a separate entry of the CLI
   build, `apps/cli/dist/native-host.js`, so the CLI's own output never reaches its stdout. It holds
   credentials, certificate pins, the `NodeBroker` connection, and the selected Node.
3. The contract, `packages/protocol/src/transport/extensionBridge.ts`. Both apps import it, because
   apps may not import each other.

Data flows sidebar → background → native host → pinned Node connection → Node. The website and the
extension never hold a token or certificate. The desktop app takes no part: the bridge pairs and
connects on its own, so the desktop can stay closed.

The extension declares no content scripts and holds no host access at install. The background
injects `content.js` and `picker.js` into a page it may read that matches a plugin's
[task chip](./browser-extension/handoffs.md#task-chips) or is an app a plugin published for a task,
which gets the [branch marker](./browser-extension/task-pages.md#the-branch-marker). A right-click on
[Ask Acorn about this element](./browser-extension/element-picker.md) injects `picker.js` alone. The manifests
(`src/manifest.ts`) ask for `nativeMessaging`, `storage`, `activeTab`, `scripting`, `contextMenus`,
and `tabs`, plus `sidePanel` in Chrome. `tabs` gives the extension every tab's address and title, but
no page content, so Home's [task list](./browser-extension/task-pages.md#homes-task-list) can switch to
a task's open tab. The browser grants these at install, and for `tabs` the install prompt reads "Read
your browsing history". They list `http://*/*` and `https://*/*` as optional host access, and
`notifications` as an optional permission, which only the person can grant, and turn off private
windows.

The toolbar button opens the sidebar and lets [page capture](./browser-extension/page-capture.md#page-access)
read the tab it was clicked on. The background handles the click and opens the panel itself, in both
browsers, because Chrome's own open-on-click grants no page access. A second click leaves the panel
open.

## Identities and registrations

Each browser starts a native host only for an extension its registration allows:

| Browser | Extension identity | Registration allows | The host is started with |
| --- | --- | --- | --- |
| Chrome | `ciaaplnahgpccadenkacgipmhmpbddjo`, pinned by the manifest `key` | `allowed_origins` | `chrome-extension://<id>/` |
| Firefox | `extension@acorn.dev`, from `browser_specific_settings` | `allowed_extensions` | `<registration path> <extension id>` |

The host checks its arguments against the same identity before it reads a frame, and exits with code
3 otherwise. Two host names exist. `com.acorn.browser_bridge` is the one
[`acorn browser install`](./cli/browser-host.md) registers. `com.acorn.browser_bridge_dev` belongs to
development sessions, so a session never replaces an installed host. The build picks the name: `vite
build` uses the installed name, and `pnpm dev:extension` builds with `ACORN_EXTENSION_HOST=development`.

## Native messaging contract

The background and the native host speak length-prefixed JSON frames. [Native messaging](./browser-extension/native-messaging.md)
lists every operation and event, and the frame limits the host enforces.

## Pairing and custody

Pairing reuses `probeNode` and `pairWithNode` from `@acorn/custody`, the same steps the desktop helper
takes. The host keeps one probe, certificate included, and `node.pair` completes it over a pinned
connection. `node.pair` takes no endpoint or fingerprint of its own, so it can only pair the Node the
person just chose. A probe comes from one of two operations:

- **`node.local`** finds the Node on this computer the way `acorn` does
  ([reaching a node with acorn](./node-distribution.md#reaching-a-node-with-acorn)). It reads the data
  root `acorn` would open, through the CLI's own `dataRootDir` and `runningNode`: the lock, the endpoint
  from `node.json`, and the certificate from `tls/cert.pem`. It reads no token, and never the desktop's.
  It then probes that endpoint and refuses it with `identity_mismatch` unless it presents the same
  certificate. The kept probe pins the file's certificate. Nobody on the network could have chosen
  it, so the sidebar shows no identity words. With no Node holding the root, it answers `null`. A
  held root with no `node.json`, or a certificate that doesn't read, is `node_error`.
- **`node.probe`** probes an address the person typed. The sidebar shows the fingerprint as six words,
  and asks for the code only after the person clicks **They match**.

The local probe can also pair by approval
([pairing by approval](./api-reference/transport.md#pairing-by-approval)). `node.ask` asks the Node
over the kept probe and keeps the secret in the host, so the extension never holds it. The sidebar
shows the phrase and calls `node.collect` once a second until the owner allows it in the desktop, with
**Use a pairing code instead** one click away for a Node no desktop is watching. A typed address can't
ask, because the Node answers an ask only from its own computer. The sidebar names the Node in
`node.collect` and `node.pair` itself, "This computer" or the address's host, and Settings renames it
with `node.rename`.

Each browser keeps its own custody, apart from the CLI's and the desktop's: a `FleetStore` and token
files under `~/Library/Application Support/acorn/browser-bridge/<browser>/`. The folder is mode 0700
and the files mode 0600, the CLI's convention. Tokens aren't encrypted at rest. `node.forget` deletes
this browser's row and token, and doesn't revoke the device on the Node.

## Selection and stale replies

The host connects only the selected Node through `NodeBroker`. `projects.list` names its Node, and the
host refuses it with `not_selected` before the request goes out and again when the answer arrives.
The sidebar also drops a reply whose `nodeId` is no longer selected. A slow read can't fill another
Node's list either way.

The host keeps the selection only while it runs. The background stores `selectedNodeId` in
`storage.local`, beside the selected Node's handoffs and the sidebar's drafts, listed in
[browser storage](./browser-extension/conversations.md#browser-storage). Each time the background starts the host, it
sends `node.select` with the stored ID before any other call. The background starts the host itself
as it starts, when an ID is stored, so the [toolbar badge](./browser-extension/notifications.md#the-toolbar-badge)
works with the sidebar closed. If the restore fails, the sidebar shows why, and pairing and
forgetting still work. An unknown Node's ID is removed from storage.

## What the sidebar shows

Each failure has a next step, written in `src/sidebar/guidance.ts`. [Set up and troubleshoot](./browser-extension/setup.md#what-the-sidebar-shows)
lists every state, how the sidebar detects it, and what it tells the person.

A regenerated certificate fails the pinned TLS chain before the fingerprint comparison runs, so the
broker reports it as unreachable and keeps retrying. The host probes the selected Node to tell the two
apart, as `openCliNode` does: after a failed read, and on each `nodes.list` while the Node is offline,
which the sidebar sends each time it opens. `nodes.list` waits at most two seconds for that probe, so a
Node that is asleep holds up the list no longer than that. A changed certificate closes that Node's
connection until it is paired again.

## Limits

- macOS only. `acorn browser install` refuses other platforms.
- Firefox loads the extension only as a temporary add-on, which leaves when Firefox quits.
- In Firefox 151, the first native host the extension starts after Firefox starts can get no process
  and no close. The 10-second deadline above ends that port. The selection restore retries once on a
  fresh port, and **Retry** opens one, and either answers at once.
- The sidebar draws no tool details or subagent streams. It draws the screenshots a turn sent and names any other attachment.
- Drafts are never expired.

## Why

The native host lives in the CLI because the CLI already carries custody, the broker, and a Node
runtime, and the standalone CLI is what people install. A second installer would duplicate all three.

Per-browser custody costs a second pairing, and it stops one browser's forget or re-pair from
changing what the other trusts. It also keeps two concurrent hosts from writing the same fleet file.
