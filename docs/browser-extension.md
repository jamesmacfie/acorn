# Browser extension

This page covers the Acorn extension for Chrome and Firefox and the native bridge it reaches a Node
through: who owns what, the native messaging contract, pairing, and the states the sidebar shows.
Read it before you change the extension, the bridge, or an operation between them. The plan for later
features is in [the extension programme](./future/extension/README.md).

Topic pages:

- [Agent conversations](./browser-extension/conversations.md): the agent operations, change hints,
  the conversation window, send retries, and browser storage.
- [Page capture](./browser-extension/page-capture.md): the link, selection, and screenshot captures,
  page access, sending them, and the attachment operations.
- [Handoffs](./browser-extension/handoffs.md): the buttons plugins put on websites, the handoff card,
  and the operations that resolve a page and create a linked task.

## What runs where

Three pieces carry a request from the sidebar to a Node:

1. The extension, `apps/extension/`. Its sidebar page (`src/sidebar/`) draws pairing, the Node list,
   and a chosen task's agent conversation. Its background (`src/background/`) owns the one native port. Chrome runs the
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
injects one, `content.js`, into a page it may read that matches a plugin's
[site button](./browser-extension/handoffs.md#site-buttons). The manifests
(`src/manifest.ts`) ask for `nativeMessaging`, `storage`, `activeTab`, and `scripting`, plus
`sidePanel` in Chrome. They list `http://*/*` and `https://*/*` as optional host access, which only
the person can grant, and turn off private windows.

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

Each message is a 32-bit little-endian length followed by that many bytes of UTF-8 JSON. Every
request carries `v: 1` and a request `id`, and the host answers with the same `id`:

| Operation | Fields | Result |
| --- | --- | --- |
| `nodes.list` | none | `{ nodes, activeNodeId, status }` |
| `node.probe` | `endpoint` | The probe result: endpoint, fingerprint, protocol, baseline, `compatible` |
| `node.pair` | `code`, `label` | The paired Node's record |
| `node.select` | `nodeId` or `null` | `{ nodes, activeNodeId, status }` |
| `node.forget` | `nodeId` | `{ nodes, activeNodeId, status }` |
| `projects.list` | `nodeId` | `{ nodeId, projects }`, each `{ id, name, path, hidden }` |
| `tasks.list` | `nodeId`, `projectId` | `{ nodeId, projectId, tasks }`: that project's active tasks, each `{ id, title, branch }` |
| `agents.profiles` | `nodeId` | `{ nodeId, profiles }`: the agents plugin's providers, each with `installed`, `authenticated`, and `diagnostics` |
| `sessions.list` | `nodeId`, `taskId` | `{ nodeId, taskId, sessions }`: the task's newest 100 unarchived sessions |
| `session.read` | `nodeId`, `sessionId`, `afterSeq`, `limit` (at most 500) | `{ nodeId, sessionId, session, records, reach, queued }` |
| `session.create` | `nodeId`, `taskId`, `providerId`, `profileId`, `key` | `{ nodeId, session }` |
| `turn.submit` | `nodeId`, `sessionId`, `input`, `key` | `{ nodeId, sessionId, turnId }` |
| `attachment.upload`, `attachment.read`, `attachment.delete` | `nodeId`, `taskId`, and the attachment | See [page capture](./browser-extension/page-capture.md#attachment-operations) |
| `handoffs.list`, `handoff.resolve`, `handoff.create` | `nodeId`, and the handoff and page | See [handoffs](./browser-extension/handoffs.md#native-operations) |

A reply is `{ v, id, ok: true, result }` or `{ v, id, ok: false, error: { code, message } }`. The host
also sends `{ v, event: 'status', status }` when the selected Node's connection changes, and
`{ v, event: 'agent', nodeId, sessions, tasks, missed }` as a change hint, and
`{ v, event: 'handoffs', nodeId }` when the selected Node's plugins change. [Agent conversations](./browser-extension/conversations.md) covers the agent
operations, hints, and what the sidebar keeps in browser storage. `turn.submit`'s `input` is the
agents plugin's turn input, limited to the parts [page capture](./browser-extension/page-capture.md)
sends: at most one `text` part of 60,000 characters, eight `context` parts, and eight `image` parts. A request
that doesn't match the schema gets a `bad_request` reply when it has a usable `id`, and nothing
otherwise. Add an operation together with the phase that first calls it.

The host enforces these limits:

- A request frame over 14 MiB closes the host. A length header can't be trusted to resynchronize, so
  the host doesn't buffer it. Every request the schema accepts fits, including an attachment upload
  at the 10 MiB limit. Chrome sends up to 64 MiB to a host and Firefox up to 4 GiB, so a request is
  never split.
- A malformed JSON frame is logged to stderr and skipped.
- Bytes of an unfinished frame at end of input are discarded and logged.
- Both browsers refuse a host message over 1 MiB, so a reply longer than 262,144 UTF-16 units goes out
  as chunk frames, `{ v, id, chunk: { index, count, data } }`.

The background rebuilds a chunked reply in any order. It refuses one that passes 16 Mi characters,
repeats an index, or changes its count. When the port closes, it fails every waiting request with
`host_unavailable`, and any reply it was rebuilding goes with it.

## Pairing and custody

Pairing reuses `probeNode` and `pairWithNode` from `@acorn/custody`, the same steps the desktop helper
takes:

1. The sidebar sends the address, and the host probes it. The host keeps the probe, certificate
   included, and returns the fingerprint.
2. The sidebar shows the fingerprint as words. The code field appears only after the person ticks
   **The words match**.
3. `node.pair` completes the kept probe over a pinned connection. It takes no endpoint or fingerprint
   of its own.

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
`storage.local`, beside the selected Node's site buttons and the sidebar's drafts, listed in
[browser storage](./browser-extension/conversations.md#browser-storage). Each time the background starts the host, it
sends `node.select` with the stored ID before any other call. If that fails, the sidebar shows why,
and pairing and forgetting still work. An unknown Node's ID is removed from storage.

## What the sidebar shows

Each failure has a next step, written in `src/sidebar/guidance.ts`:

| State | How it is detected | Next step shown |
| --- | --- | --- |
| Host missing | The port closes with "not found" (Chrome) or "No such native application" (Firefox) | Run `acorn browser install` |
| Host stopped | Any other close, or no reply within 10 seconds | Retry, or run `acorn browser status` |
| Bad code | The Node refuses the pairing | Check the code and try again |
| Incompatible | The probe reports another protocol, or the broker marks the Node `incompatible` | Update whichever side is older |
| Offline | The broker reports `offline`, or a read fails | Check that the Node is running |
| Revoked | The Node answers 401 `unauthenticated` | Forget the Node and pair again |
| Identity changed | A failed read, then a probe whose fingerprint differs from the pin | Check with the Node's owner, then pair again |
| No agent can start | Every profile is uninstalled or signed out | The profile's own diagnostic |
| Conversation gone | `session.read` answers `not_found` | The draft is kept; choose another conversation |
| Conversation archived | The session row has `archivedAt` | The draft is kept; sending is off |
| Node away | The selected Node's status is neither online nor degraded | The draft is kept; sending is off until it returns |
| Agent waiting | The session's `attention` is `permission` or `question` | Answer it in the Acorn app for now |
| No page access | The active tab has no readable address, or the browser refuses the capture | Click the Acorn toolbar button on the page, then capture again |
| Page changed | The active tab or its address changed while a capture ran | Capture again |
| Handoff refused | The plugin's route answered an error, such as no connected account | The plugin's own message, with **Try again** |
| Nothing to hand off | The page resolved to no items | None; the page isn't an item this Node can open |

A regenerated certificate fails the pinned TLS chain before the fingerprint comparison runs, so the
broker reports it as unreachable. The host probes after a failed read to tell the two apart, as
`openCliNode` does, then closes that Node's connection until it is paired again.

## Limits

- macOS only. `acorn browser install` refuses other platforms.
- Firefox loads the extension only as a temporary add-on, which leaves when Firefox quits.
- In Firefox 151, the background's first native port after the browser starts has been seen to get no
  host process and no close. The 10-second deadline above recovers from it, and the selection restore
  retries once on a fresh port. A port opened from the sidebar page at the same moment answers.
- The sidebar can't answer an agent's question or permission request yet, and draws no tool details or
  subagent streams. It draws the screenshots a turn sent and names any other attachment.
- Drafts are never expired.
- The real-browser results and their gaps are in
  [phase 01](./future/extension/01-native-pairing.md#real-browser-results),
  [phase 02](./future/extension/02-agent-conversation.md#real-browser-results),
  [phase 03](./future/extension/03-page-capture.md#real-browser-results),
  [phase 04](./future/extension/04-github-handoff.md#real-browser-results),
  [phase 05](./future/extension/05-linear-handoff.md#real-browser-results), and
  [phase 06](./future/extension/06-rollbar-handoff.md#real-browser-results).

## Why

The native host lives in the CLI because the CLI already carries custody, the broker, and a Node
runtime, and the standalone CLI is what people install. A second installer would duplicate all three.

Per-browser custody costs a second pairing, and it stops one browser's forget or re-pair from
changing what the other trusts. It also keeps two concurrent hosts from writing the same fleet file.
