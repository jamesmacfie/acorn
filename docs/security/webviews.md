# Host-owned webviews and browser automation

This page covers the native webviews the desktop hosts for previews and plugins, and the separate
browser agents drive. Read it before you change preview loading or a browser tool. It's part of the
[security model](../security.md). [The shell](../shell/webviews.md#host-owned-webviews) owns the webview
lifecycle.

## Webviews

The desktop view service owns every child webview. Each gets an ephemeral session, no preload,
navigation checks, denied permission requests, and browser chrome outside the guest page.

Acorn's own Tauri commands are listed in the application ACL permission at
`apps/desktop/src-tauri/permissions/renderer-commands.toml`. The `default` capability grants that
permission only to the `main` webview. Tauri checks application commands even for local origins when
the application ACL exists, so plugin and preview child webviews cannot call them. Before dispatch,
the shell also checks the receiving webview's label and top-level renderer URL. The plugin interface
frame is an `app-plugin://` iframe within `main`, not a separate webview; its cross-origin isolation
and lack of an invoke key keep it from sending an invocation. Tauri's webview-label ACL cannot
distinguish that iframe from its parent if a future change were to expose the key to it.

When you register a desktop command, add it to `renderer-commands.toml`. The generated-ACL Rust test
checks that the grant matches the handler list and exercises Tauri's authorization resolver for each
command. Keep `main` as the renderer label and grant by webview, because child pages share its window.

A loaded plugin may declare a host-owned webview. Unlike its sandboxed interface frame, the remote
page has live network access and its own cookies and login state for the life of the process. The
trust prompt names the declared hosts as a separate grant. The shell enforces that allowlist across
requested navigations and redirects, and gives each surface an isolated ephemeral partition. The
plugin gets no page preload, devtools protocol driver, devtools, script injection, or
`postMessage` path, so it can choose the URL but can't inspect or operate the page.

## Previews

The preview pane refuses every remote Node URL, public and loopback alike. A child webview can check
a navigation but can't confine the page's redirects and subrequests to the remote Node's network, so
page script could reach services on the client's private network. Only a Node that custody marks
local can supply a loadable preview URL. Switching a pane to a remote Node evicts its kept-alive
native view.

## Desktop automation driver

The desktop's separate WebDriver server runs only in a debug build with Cargo's
`agent-automation` feature. The shell's `compile_error!` in
`apps/desktop/src-tauri/src/lib.rs` refuses that feature when release assertions are disabled, so
the release build cannot include the driver. The debug server binds `127.0.0.1` on desktop and
accepts only a single `Host` for its selected `127.0.0.1:<port>` endpoint. It refuses a foreign or
duplicate `Origin` before routing any command. Acorn's Node driver sends no `Origin`; a matching
same-origin value is also accepted. This check blocks browser cross-origin and DNS rebinding
requests. It does not authenticate another local process that can send its own headers. The vendored
plugin's Android debug path binds all interfaces, and this desktop endpoint policy does not support
its WiFi driver mode.

## Agent browser tools

Agent browser tools drive the Node's own browser, through `plugins/browser`, never the person's
preview pane. The pane a person is looking at isn't something an agent steers.

- Each task gets its own browsing context, so cookies, storage, and any login one task's work set up
  never reach another's.
- Fills go through the resolved accessibility node rather than a selector, so a page can't swap in a
  different element between the snapshot an agent read and the value it writes.
- The tools expose no arbitrary JavaScript evaluation.

Screenshots are rows in the plugin's own database, keyed to the task, and served only through
`/v1/p/browser/captures/:id` behind the usual auth. The newest 20 per task are kept. The route checks
the capture's task against the principal: a task token reads only its own captures, and device and
service principals read across tasks. A foreign or unknown id gets the same empty 404. Browser context
allocation and page diagnostics have resource budgets of their own
([browser tools](../agent-tools/browser-and-scripts.md#browser-tools)).
