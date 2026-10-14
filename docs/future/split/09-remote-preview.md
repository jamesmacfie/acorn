# Phase 9: decide how a remote Node's preview reaches the desktop

Date: October 14, 2026. Status: proposed design spike. No build work until the spike decides.

## Goal

Decide how the preview pane shows an app running on a remote Node, without letting that page reach
services on the client's private network. Record the decision here. If it's a build, write the build
phase.

## Starting point

`remotePreviewBlocked` in `packages/client-core/src/infra/node/previewUrl.ts` turns the preview off
for any Node that isn't local. Its comment gives the reason: the desktop's child webview can check
top-level navigation but can't confine redirects and page requests to the Node's network. A
malicious page could probe the client's local network. The allowlist for preview addresses is in
`apps/desktop/src-tauri/src/webviews.rs`.

A preview on a remote Node is usually `http://localhost:<port>` on that machine, which the client
can't reach anyway.

## Options

- **The Node proxies the page.** The Node fetches the preview from its own loopback and streams it
  over the existing pinned and authenticated connection. The shell serves it to the child webview from
  a custom scheme, and every request from the page goes back through that scheme to the Node. The page
  never touches the client's network. This is the most work, and the only option that gives a remote
  Node the same pane as a local one. I recommend spiking this one.
- **An SSH tunnel, documented.** The pane shows the tunnel command for the port and stays blocked.
  This is cheap. It's honest, but it isn't a preview.
- **Open in the system browser with a warning.** The browser has the same network reach the webview
  would have, so this moves the risk rather than removing it. I don't recommend it.

## What the spike must answer

1. Can the shell's custom scheme handler carry every request a modern dev server makes, including
   WebSocket upgrades for hot reload, without the page falling back to a direct request?
2. What does a redirect to an outside address do under the proxy? Name the rule.
3. Latency on the phase 2 container Node for a page load and a hot reload, measured and dated here.
4. Which route family on the Node carries the proxy, and what stops a task token from using it to
   reach other services on the Node's network?

## Acceptance

This file records a decision with the measurements behind it, and either a build phase or the reason
for keeping the block.
