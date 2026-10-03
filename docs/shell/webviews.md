# Host-owned webviews

This page covers the child webviews the shell owns: the browser preview and loaded-plugin webview
pages, their history and lifetime, how the preview finds its URL, and the dormant preview tunnel. Read
it before you change preview behavior or a webview policy. It's part of [desktop shell](../shell.md).

## Host-owned webviews

`apps/desktop/src-tauri/src/webviews.rs` owns every child webview: the browser preview pane and
loaded-plugin webview pages. The two differ only by a policy function and a key prefix. Keys are
`preview:<taskId>` and `plugin:<pluginId>:<nodeId>:<surface>[:<taskId>]`, and the Node ID keeps each
Node's page storage and navigation separate. The prefix and key shape are validated, because they
select the policy. A ceiling of 32 webviews caps what a renderer bug that ensures in a loop can cost.
Child webviews deny `window.open`.

A child webview under `Window::add_child` composites over the main one and takes logical bounds from
the pane's geometry. It doesn't inherit DOM overflow clipping, so the renderer intersects the host
element with the viewport and every clipping ancestor before it sends bounds, and the child hides when
nothing is visible. On macOS, the main renderer composites above the page through
[native overlays](../native-overlays.md). Elsewhere, and when that layer is off or failed, rectangle
overlap hides the page. `incognito(true)` gives each child its own temporary data store.

Local-Node preview is one kept-alive webview per task, limited to HTTP and HTTPS URLs without
credentials, with chrome the renderer draws. Remote-Node preview is unavailable: the native webview
has no network policy for page subrequests, so a remote page could reach services on your private
network. The pane says so, and evicts a view when its Node becomes remote. Only the positively
identified local Node may create previews. In development, the preview's DevTools button targets the
child webview and reapplies its bounds after WebKit opens the inspector.

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
native key. Eviction advances the key's generation at once, drops queued work, and retires the old
view before any replacement. Retired callbacks read a denied policy and stop reporting.

Pane cleanup removes observers and hides only its task's view. Overlay changes don't call `ensure`. A
pending configuration read or an absent URL hides without evicting. A resolution error or native
refusal offers **Retry preview**. A Node switch retires the whole preview family, including records
from before a renderer reload, and a family generation rejects stale commands. Task archive, owner
removal, window close, and shutdown release resources. Loaded plugin pages are evicted on unmount and
on policy replacement.

### Background scheduling and document loss

Background throttling stays at the engine's default. Hidden pages keep their state while the engine
keeps their document, and there's no inactivity eviction. Retiring an incognito page discards its
document and storage.

The pinned stack is Tauri 2.11.5, tauri-runtime-wry 2.11.4, and wry 0.55.1. Tauri exposes no
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

The preview home belongs to the Node. `preview.urls` resolves, in order, a layout recipe's selected
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

## The preview tunnel

The tunnel in `@acorn/custody/supervision/previewTunnel.ts` stays in custody, but the pane doesn't
open it while remote preview is off. A tunnel alone isn't a browser network boundary, because a
loaded page can make more requests straight from your computer.

The listener binds `127.0.0.1` explicitly. Opening a key already in flight returns the same promise,
and admission reserves a slot at once, so pending and live listeners together count toward the limit of
16. Closing a task or Node retires pending binds too, and callbacks keep their entry identity so they
can't touch a replacement. Disposal refuses further opens.

Each listener has a 32-byte base64url secret. wry can't add a request header, so the helper reports
each port and secret to Rust on stdout, and the shell seeds an `acorn_tunnel` cookie into the pane
before its first navigation. The renderer never sees the secret. `authorize()` accepts the
`x-acorn-tunnel` header or the cookie, compares with `timingSafeEqual` on a length-checked pair, and
destroys the socket on a mismatch before dialing the Node. It scans the request head as `latin1`,
because a UTF-8 decoder could make two byte strings compare equal.

A connection that never completes a request head is refused after two seconds, with at most 8 KB
buffered. An idle listener with no connection for 60 seconds is closed, as a backstop for a crashed
renderer. Both sides pause their socket until the other accepts the last chunk, so backpressure goes
through the kernel.
