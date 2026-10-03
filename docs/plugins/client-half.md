# The client half of a loaded plugin

This page covers how a device turns a loaded plugin's manifest and bundle into UI, and how a device
installs a client-only package itself. It's part of the [plugin reference](../plugins.md).

## Loaded plugins: the client half

A loaded plugin's UI isn't registered by its own code. The Node hands each device the plugin's
manifest and the hash of its client bundle in the roster, `GET /v1/core/plugins`. The device decides
what to render from that, and the plugin's JavaScript never touches a shell registry.

Five kinds of client contribution come out of one manifest:

- [Frames](./frames.md): iframes the plugin draws itself.
- [Remote trees](./remote-trees.md): host components named by a worker.
- [Document surfaces](./document-surfaces.md): text documents the host's editor draws.
- [Webviews](./document-surfaces.md#webviews): external pages in a shell-owned child webview.
- [Descriptors](./descriptors.md): data the host draws with its own components.

A device can also install a client-only package itself. Its manifest and bundle come from the device
cache instead of a Node roster, and the same registration and sandbox paths handle both.

Each host draws before the Node it started is up, so the pass that reads the fleet's rosters, caches
bundles, and registers contributions can't run from a composition root. At that point the fleet list
is empty and every Node reads offline. `watchPluginChanges` (`host/plugins/reload.ts`) first reads
cached device bundles without a Node request, then reads each Node when it becomes reachable or
reconnects. It keeps the registrations reconciled for the rest of the session from the Node's
`plugins:changed` broadcast. Both hosts call it.

[Distribution](./distribution.md) covers which bundle a device selects and when it's trusted.

## Device-held plugins

**Install…** under **Settings > Plugins > Installed**, with **This device** as the target, installs a
GitHub release, an npm package, an HTTPS tarball, or a local folder where the host has a folder
picker. The helper resolves and validates the package, hashes its client bundle, and holds the
manifest with that bundle. A folder is read again on update, so it pins no source bytes. Installation
and update go through the ordinary per-hash trust prompt, and the plugin appears after acceptance
without restarting the app.

A device package can't declare a Node entry, a migration chain, a Node permission, or a contribution
whose handler runs on a Node: routes, schedules, tools, context sections, providers, harnesses, task
checks, audit actions, data sources, and discovery handlers. It also can't use descriptors that point
at plugin-owned Node routes, including the `items` form of a rail source. A client-only source
declares `tree: { list, detail }` with two remote-tree entries, and the host mounts them in its browse
layout. The helper rejects an invalid package before caching it, and the client checks again before
registering.

A device package's code runs in the same sandboxed iframe or remote-tree worker as a Node-delivered
bundle, never in the shell process. On the desktop, a host-owned relay document at the bundle's
`app-plugin://<hash>` origin creates the remote-tree worker, so the bundle never runs under the
renderer's `app://acorn` origin.

One bundle is active per plugin id. A compatible device bundle wins over any Node's offer of that id,
even a newer one. Version and hash order choose among device candidates. Settings lists the Nodes
that offer the same bundle. Device enablement and `plugin:<id>:*` state stay on the device.

Removing a device plugin drops its cached bundle, its preferences, and its live contributions, and
returns any exclusive slot it held to core. Manual trust acknowledgements survive removal, so
installing the same bytes again doesn't ask again.
