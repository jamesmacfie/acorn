# The node half and bundled plugins

This page is the reasoning behind how a loaded plugin's node half runs, and why acorn ships some of its
own plugins as loaded packages. It's part of [extensibility](../extensibility.md).

## The node half is isolated

A loaded plugin's server code runs in a dedicated, permission-scoped worker realm. Its
`permissions.node` block shapes the owner-bound context sent over RPC and the worker's network and
child-process grants. The worker can read its package and, when it owns migrations, its own SQLite
files. It can't load `node:sqlite` directly, open core or other plugins' databases, create raw sockets
without a `sockets` grant, load native addons, or start nested workers. The RPC transport loads when
the first external plugin starts, so a start with only bundled packages doesn't evaluate it.

Every surface renders those host and runtime grants as enforced. Plugin-authored schedule and task
check behavior stays declared: acorn controls when and where it runs, but can't verify its intent. An
operating-system adversarial and crash boundary remains rung 3 in
[the node realm](../security/plugin-node-realm.md). The worker boundary keeps the public plugin API,
including its synchronous registration seams.

A synchronous seam costs the calling thread. The caller waits in `Atomics.wait` until the other realm
answers, and on the host that thread is the Node's event loop, so nothing else on the Node runs in
the meantime. Two rules keep that bounded:

- Each realm answers a synchronous call as soon as it arrives, ahead of promise-shaped work already in
  flight, so a route handler waiting on the blocked realm can't leave both sides waiting forever.
- A call that goes unanswered for five seconds throws, so a crashed or stuck worker costs one call, not
  the whole Node.

Anything a plugin exposes across a synchronous seam has to return at once. Each end reuses the shared
buffers its answers came back in, because a fresh 4 MiB buffer per call is freed only when both threads
collect, and on a busy Node that held about 450 MB. A buffer whose call timed out is dropped, because
the other realm may still write to it.

Promise-shaped calls run concurrently, so one route waiting on a slow third party doesn't stop the
plugin answering anything else, as with a compiled plugin.

`packages/node-core/src/server/plugins/functionMode.ts` decides which of a plugin's functions cross
synchronously, by the path the function sits on. Everything it doesn't name crosses as a promise. A
missing rule is silent: the host reads the returned promise as the value it asked for, every field
comes back `undefined`, and the failure shows up in whatever the caller does next. Adding a synchronous
contract to the plugin API means adding it there, naming the methods, not the object that holds them.

## Bundled plugins: shipped, but loaded

Moving Rollbar out of the binary created a category: plugins acorn ships, loaded instead of compiled.
The app stages them as ordinary packages and seeds them into the data root, so a person notices
nothing on upgrade. The bundled roster is agent-cost, database, http, linear, model-providers,
rollbar, and sentry-telemetry ([distribution](../plugins/distribution.md)).

This isn't a workaround. A bundled plugin runs on the same path a stranger's does: the same manifest,
loader, sandbox, and permission shaping. Its only difference is provenance. Its bytes came from the
app the person already installed, so they need no separate trust prompt. Every bundled plugin is a
continuous, real test of the loaded tier.

The lifecycle policy is generic: seed a package when it's missing, update it when the app's copy
changes, never overwrite one the owner installed, and remember an uninstall so an upgrade can't bring
it back.
