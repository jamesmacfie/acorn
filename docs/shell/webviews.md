# Host-owned webviews

This page covers the child webviews the shell owns: the browser preview and loaded-plugin webview
pages, their history and lifetime, and how the preview finds its URL. Read it before you change
preview behavior or a webview policy. It's part of [desktop shell](../shell.md).

## Host-owned webviews

`apps/desktop/src-tauri/src/webviews.rs` owns every child webview: the browser preview pane and
loaded-plugin webview pages. They differ only by a policy function and a key prefix. Keys are
`preview:<taskId>`, `remote-preview:<nodeId>:<taskId>`, and `plugin:<pluginId>:<nodeId>:<surface>[:<taskId>]`,
and the Node ID keeps each Node's page storage and navigation separate. The prefix and key shape are validated, because they
select the policy. A ceiling of 32 webviews caps what a renderer bug that ensures in a loop can cost.
Child webviews deny `window.open`.

A child webview under `Window::add_child` composites over the main one and takes logical bounds from
the pane's geometry. It doesn't inherit DOM overflow clipping, so the renderer intersects the host
element with the viewport and every clipping ancestor before it sends bounds, and the child hides when
nothing is visible. On macOS, the main renderer composites above the page through
[native overlays](../native-overlays.md). Elsewhere, and when that layer is off or failed, rectangle
overlap hides the page. `incognito(true)` gives each child its own temporary data store.

Local-Node preview is one kept-alive webview per task, limited to HTTP and HTTPS URLs without
credentials, with chrome the renderer draws. Only the positively identified local Node's address goes
to the webview as it is. In development, the preview's DevTools button targets the child webview and
reapplies its bounds after WebKit opens the inspector.

### A remote Node's preview

A remote Node's app loads through a listener the helper opens for that task
([the bridge and broker](./bridge-and-broker.md#previews)), on `http://127.0.0.1:<port>`. Its view is a
`remote-preview:<nodeId>:<taskId>` key, which shares the preview family's one visible view. Three things
confine the page, and each covers what the others can't:

- **Navigation.** The view's policy is the exact origin of its home, and only when that host is
  `127.0.0.1` with a port. A link, a redirect, or a frame going anywhere else is refused, and the shell
  emits `acorn:webview-blocked`. The pane shows the refused address with a copy button. wry asks the
  policy for subframes too.
- **Requests.** The listener adds a content security policy to every response that holds the page's
  own requests to its origin.
- **WebRTC.** A peer connection ignores that policy. Before the first navigation, `create` turns off
  WebKit's private `WKPreferences` setting `_peerConnectionEnabled` through `with_webview`, and reads it back.
  If WebKit doesn't have the setting, `create` refuses the view, so a WebKit update fails closed. A
  proxied page has no `RTCPeerConnection`.

Only macOS has the switch, so the bridge offers `previewProxy` there and nowhere else. On Windows and
Linux, and for a remote address that isn't plain `http` on the Node's own loopback, the pane says why
it shows nothing. Evicting a remote preview closes its listener too, and a Node switch evicts every
preview.

Other plugins can add up to four controls after the preview's address bar, and ask it to reload the
page on screen. They never get the page or a way to navigate. See [toolbar
actions](../plugins/toolbar-actions.md).

A loaded plugin's webview page is checked against its manifest hosts by the renderer broker and again
here. Two independent checks mean widening the grant in one layer can't widen the other.

### History and reconciliation

wry exposes no navigation history, so the shell keeps its own. `on_navigation` reports every
navigation, including script-driven ones, and the module marks traversals it asked for so they move the
cursor instead of truncating the future. The callback reads the record's live host policy on every
navigation. When `ensure` gets a changed policy, the shell swaps it and closes the old view before
opening a fresh one, which cancels any in-flight navigation on a revoked host. An empty or invalid
replacement retires the old view. If native close fails, the shell hides the view, tries to blank it,
refuses further calls for it, and retries close on the next `ensure`.

`ensure` reconciles a normalized configured home separately from the page's location, using Tauri's
URL parser. Equal homes and policies reuse the native document, even after a redirect or typed
address. A changed home navigates once. A failed navigation leaves the applied home unchanged, so
**Retry preview** can try again. **Home**, **Reload**, address entry, and history traversal are explicit
browser actions.

The bridge registers its state listener before calling `ensure`. Each successful reconciliation
replays the URL, loading state, and history cursor to the mounted toolbar. Operations are ordered per
native key. Eviction aborts the key's owner signal at once, which drops queued work, and retires the
old view before any replacement. Retired callbacks read a denied policy and stop reporting.

Pane cleanup removes observers and hides only its task's view. Overlay changes don't call `ensure`. A
pending configuration read or an absent URL hides without evicting. A resolution error or native
refusal offers **Retry preview**. A Node switch retires the whole preview family, including records
from before a renderer reload, and the family's owner signal rejects stale commands. Task archive, owner
removal, window close, and shutdown release resources. Loaded plugin pages are evicted on unmount and
on policy replacement.

### Background scheduling and document loss

Background throttling stays at the engine's default. Hidden pages keep their state while the engine
keeps their document, and there's no inactivity eviction. Retiring an incognito page discards its
document and storage.

The pinned stack is Tauri 2.12.4, tauri-runtime-wry 2.12.2, and wry 0.57.0. Tauri exposes no
content-process termination callback, so acorn can't tell an engine unload from a page reload. It does
no inferred recovery. **Reload** and **Home** recover explicitly, and neither an engine crash nor a
restart keeps form values or full history.

| Platform | Scheduling | Process loss and recovery |
| --- | --- | --- |
| macOS | Default WebKit scheduling, measured in the preview acceptance record | No termination callback through Tauri. Reload or Home. |
| Windows | Default WebView2 scheduling, not measured | No portable termination callback. Reload or Home. |
| Linux | Default WebKitGTK scheduling, not measured | No portable termination callback. Reload or Home. |

[Preview retention acceptance](../testing/preview-retention.md) holds the measurements. The
automation-only `webview_diagnostics` command reports content process IDs and footprints on macOS,
with no page contents or URLs.

Normal webviews expose no automation server. The `agent-automation` build gives the main window a
loopback-only WebDriver server for a local development agent, and doesn't drive child webviews. Agent
browser automation is `plugins/browser`, which runs Playwright on the Node.

## The preview URL

The preview home belongs to the Node. `previewTarget` (`packages/client-core/src/infra/node/previewUrl.ts`)
decides how it reaches the webview: `direct` for the local Node, `proxied` for an app on a remote Node's
loopback, or `blocked` with a reason. `remotePreviewBlocked` and `previewUrlForClient` stay for plugins
until the next plugin API major.

`preview.urls` resolves, in order, a layout recipe's selected
target URL, the running default target, and the project's URL, port, or script setting, with script
discovery on the Node in the task worktree. The pane reads `/v1/p/preview/tasks/:id/url` and reads
again on `plugin:preview:url-changed { taskId, url, source }`, where `url` and `source` are `null` when
the last preview goes away. The terminal client's recipe picker reaches preview through the
`preview.recipeSelection` client capability.

Overlapping reads for one task share one resolution, scripts included. A finished read isn't cached.
Recipe, run-target, project, and task changes retire affected reads, and their callers get `null`.
Running scripts finish under the core process owner's 10-second deadline. The runtime forgets archived
tasks' state when it reconciles `tasks:changed`. The pane captures its Node and task per read, so a
result from the old Node can't become a same-ID task's home on the new one.

The pane button and **Open Preview** appear only on a task with somewhere to find a URL.
`/v1/p/preview/configured` answers for every active task by checking each step is filled in: a picked
recipe URL, a default target with `url` or `urlCommand`, or a project preview setting. It runs no
script, so stopping the dev server doesn't close an open preview.
`plugins/preview/src/client/configuredStore.ts` holds the answer and reads again on a URL change, a
project change, an unseen task, a Node switch, and a reconnect. A Node that answers 404 gets the pane on
every task.
