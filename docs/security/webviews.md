# Host-owned webviews and browser automation

This page covers the native webviews the desktop hosts for previews and plugins, and the separate
browser agents drive. Read it before you change preview loading or a browser tool. It's part of the
[security model](../security.md). [The shell](../shell.md#host-owned-webviews) owns the webview
lifecycle.

## Webviews

The desktop view service owns every child webview. Each gets an ephemeral session, no preload,
navigation checks, denied permission requests, and browser chrome outside the guest page.

A loaded plugin may declare a host-owned webview. Unlike its sandboxed interface frame, the remote
page has live network access and its own cookies and login state for the life of the process. The
trust prompt names the declared hosts as a separate grant. The shell enforces that allowlist across
requested navigations and redirects, and gives each surface an isolated ephemeral partition. The
plugin gets no page preload, devtools protocol driver, devtools, tunnel headers, script injection, or
`postMessage` path, so it can choose the URL but can't inspect or operate the page.

## Previews

The remote preview tunnel accepts only declared task ports
([preview tunnel](../api-reference/websocket.md#preview-tunnel)) and authenticates its loopback request
with a per-tunnel secret before forwarding it to the Node.

The preview pane refuses every remote Node URL, public and tunnelled loopback alike. A child webview
can check a navigation but can't confine the page's redirects and subrequests to the remote Node's
network, so a tunnelled first request would still let page script reach services on the client's
private network. Only a Node that custody marks local can supply a loadable preview URL. Switching a
pane to a remote Node evicts its kept-alive native view.

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
([browser tools](../agent-tools.md#browser-tools)).
