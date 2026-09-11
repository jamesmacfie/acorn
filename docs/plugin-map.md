# How a plugin fits together

A plugin adds functionality through declared APIs. Keep its data and implementation private; use
capabilities for calls, events for notifications, and extension points for contributions to another
plugin's UI or behavior.

For a third-party package, start with [Plugin authoring](./plugin-authoring.md). For signatures and
limits, use the [Plugin reference](./plugins.md).

## The four shapes a plugin can take

Compiled and loaded describe how a plugin is installed. Frame and tree describe its client UI.
A loaded plugin can have a node half, a client half, both, or only manifest descriptors.

| Form | Runtime | Authoring API |
| --- | --- | --- |
| Compiled plugin | Built into the Node or client | Repository facade and plugin context |
| Loaded node plugin | Imported from an installed directory | Permission-filtered node context |
| Frame | Desktop iframe | Sandbox bridge and browser DOM |
| Remote tree | Desktop worker or terminal worker | Sandbox bridge and shared component tree |

Use a tree for UI that must work on desktop and terminal. Use a frame for browser-specific rendering.
The default scaffold emits a tree without a build step; `--rectangle` emits a frame.

Node plugins run on one Node. Client connections form a fleet, but a plugin's database and capability
registry do not span that fleet. Keep client reads, caches, and subscriptions scoped to the selected Node.

## Startup

The Node awaits each plugin's `init(ctx)`, then each optional `ready(ctx)`, before opening the listener.
Loaded packages initialize after their declared `requires.plugins` dependencies. Resolve optional
capabilities at call time so a reload or disabled provider does not leave a cached implementation.

Compiled client plugins register contributions synchronously in `init(ctx)` and start side effects
in `activate(ctx)`. Handle rejections from asynchronous work started there.

The host rolls back registrations when a loaded plugin fails initialization and records the failure
in its roster. A compiled plugin initialization failure stops boot. The host calls `dispose()` before
closing plugin storage.

## The node API

Use `acorn-plugin-types` for the loaded `NodePluginContext` declaration. Its main groups are:

| Group | Purpose |
| --- | --- |
| `routes.fetch` | Register a portable request handler under `/v2/p/<id>/` |
| `storage.open` | Open the plugin's host-migrated SQLite database |
| `core` | Access granted core services and entity projections |
| `capabilities` | Provide or resolve a named plugin API |
| `events` | Subscribe to granted events and publish notifications |
| `schedules`, `taskChecks`, `runs` | Register periodic work, archive checks, and run listings |
| `providers`, `collections` | Register providers and data collections |
| `extensionPoints`, `hooks` | Accept contributions and run declared hooks |
| `audit`, `telemetry`, `log` | Record actions and operational diagnostics |

Loaded plugins do not receive `routes.register`, `tools`, `contextSections`, `providers.model`,
`events.channel`, or `events.streams`. Those members belong to the compiled context.

Core returns projections such as `TaskRef`, not database rows. A manifest grants each core facet
explicitly. Context permissions guide cooperative node code; they do not isolate an in-process plugin
from Node builtins. For the trust boundary, see [Security](./security.md).

## The client API

Compiled clients use `ClientPluginContext` to register panes, rail sources, commands, settings,
slots, extension points, collections, and other contributions. Loaded clients declare their
contributions in the manifest and use the sandbox bridge at runtime.

A remote tree names components in the shared kit. The host owns rendering, focus, and keyboard
behavior. A frame owns its DOM and requests host operations through the bridge.

Contribution `requires` fields express host requirements. A contribution's `when` predicate controls
its own contextual availability. Gate desktop operations and provide a terminal alternative where
appropriate; a shared component does not make an iframe or webview available in a terminal.

For each contribution's availability, see [Contribution kinds](./contribution-kinds.md).

## Import entrypoints

| Package or entrypoint | Use |
| --- | --- |
| `acorn-plugin-types` | Standalone node declarations, with no runtime import |
| `acorn-plugin-sdk` | Bridge helpers for a bundled third-party client |
| `acorn-plugin-sdk/remote` | Shared tree nodes and Solid adapter for a bundled client |
| `@acorn/plugin-api/node` | Repository node facade |
| `@acorn/plugin-api/client` | Repository client contracts and services |
| `@acorn/plugin-api/ui` | Repository component kit |
| `@acorn/plugin-api/ui/host` | Components that depend on host context |
| `@acorn/plugin-api/ui/tree` | Remote-tree nodes for repository bundles |
| `@acorn/plugin-api/ui/sdk` | Repository bridge helpers |
| `@acorn/plugin-api/ui/editor` | CodeMirror themes, language selection, view state, and embedded editors |
| `@acorn/plugin-api/ui/diff`, `ui/tokens` | Diff tools and component role tokens |
| `@acorn/plugin-api/testkit`, `testkit/client` | Repository test helpers |

`@acorn/plugin-api` is private to the workspace. Do not use it as an npm runtime dependency in a
third-party package. Bundle runtime dependencies into the output; an unbundled client file cannot
resolve package imports. A remote tree must not import the DOM component barrel.

## Events

`ctx.events.on` subscribes to events on the plugin's Node, including when no client is attached.
Declare each channel in `permissions.events`.

Core channels are defined in `packages/protocol/src/nodeEvents.ts`:

- `plugins:changed`
- `tasks:changed`
- `connection:changed`
- `head:changed`
- `run:changed`
- `agent-session:changed`
- `project:changed`
- `terminal:sessions-changed`
- `worktree:status-changed`

A plugin publishes `plugin:<id>:<verb>`. Another plugin can subscribe when the producer declares the
verb in `emits` and the consumer grants the full channel. Missing producers emit nothing.

Events have no replay or delivery guarantee. Re-read stored state after startup or reconnect.
Use `ctx.events.status()` to invalidate your descriptors and `worktreeStatus(taskId)` after a
worktree change. Store durable work in your own database.

The client-local `clientEvents` emitter carries presentation and lifecycle events within one client.
It does not notify other devices. Compiled clients can also register WebSocket handlers through
`registerWsChannel`. Loaded clients subscribe through the bridge.

## Talking to another plugin

Resolve a capability through `ctx.capabilities.get(id)` when you need a result. `get` returns
`undefined` when the provider is absent or the capability is ungranted; `require` throws.
Declare required plugin dependencies and capability permissions in the manifest.

Share identifiers and types through public contracts. Do not import a provider's implementation,
read its database, or use core internals to bypass a missing API. For working fragments, see
[Events and capabilities](./plugin-authoring/events-and-capabilities.md).

## Notifications

Use `ctx.events.notice` for a notification from a node plugin. The host binds a loaded plugin's
notification destination to that plugin and drops its supplied `target` and `kind` fields.
Use attention contributions for persistent conditions that the user needs to resolve.
For delivery and acknowledgment behavior, see [Notifications](./notifications.md).

## Attaching to the rail

Declare a source and the contributions it needs, such as routes, project surfaces, and content-link
resolution. Keep IDs in the plugin's namespace. Use status invalidation when source data changes.
For the complete source descriptor, see [Descriptors](./plugins/descriptors.md).

## Example: a compiled plugin, both halves

Register the node and client entrypoints in the application rosters. Import host contracts through
the repository facade, keep plugin-owned types in `contract/`, and contribute UI through the shared kit.
For package layout and registration, see [Package shape](./plugins/package-shape.md).

## Example: a loaded plugin pushing to its own tree

Create the default scaffold, then have the node save its data and emit on its own plugin channel.
The tree subscribes through the bridge and fetches the updated data from the plugin's route.
For the event declarations and calls, see [Publish an event](./plugin-authoring/events-and-capabilities.md#publish-an-event-for-another-plugin).

## Rules that bite

Keep plugin IDs stable. Declare permissions before calling gated APIs. Do not cache optional
capability implementations across reloads. Keep node data on the Node and client presentation state
on the device. Check UI behavior on both hosts when declaring support for both.

## Where to go next

- [Plugin authoring](./plugin-authoring.md)
- [Plugin reference](./plugins.md)
- [Contribution kinds](./contribution-kinds.md)
- [Architecture overview](./architecture-overview.md)
