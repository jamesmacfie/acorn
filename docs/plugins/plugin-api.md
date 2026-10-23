# The plugin API

This page covers the private facade compiled plugins import, the two node context types, and the
verbs every registry shares. Read it before you add or remove an export a plugin reaches. It's part
of the [plugin reference](../plugins.md). The published packages a third-party author installs are
in [Published packages](./publishing.md).

## The plugin API

`packages/plugin-api` (`@acorn/plugin-api`) is the private source facade for compiled plugins in this
repository. It re-exports an enumerated slice of node-core and client-core. The boundary test
requires compiled plugins to reach the host through this facade and keeps the facade free of
implementation. Loaded third-party packages use `acorn-plugin-types` and `acorn-plugin-sdk` instead.
They can't import `@acorn/plugin-api` from npm.

The facade has 14 entrypoints:

| Entrypoint | What it carries |
| --- | --- |
| `@acorn/plugin-api/node` | `NodePlugin`, the route toolkit (`AppEnv`, `respondError`, `portableCarrier`, and the first-use loaders `lazyFetch` and `lazyRouter` from [Load a route on first use](../plugin-authoring/the-node-half.md#load-a-route-on-first-use)), the `PluginDatabase` handle type, `CoreServices` with its `ProjectRef` and `TaskRef` projections, and provider and integration contracts |
| `@acorn/plugin-api/client` | `ClientPlugin`, the API client and query options, client events, contribution types, registration seams such as `registerCommands`, `registerKeybindings`, and `slotFills`, task, workspace, and fleet state, the design system's plain functions, and `readLocal`, `writeLocal`, and `clearLocal` for per-device scraps such as an unsent draft |
| `@acorn/plugin-api/ui` | Frame-safe presentation components from the kit, `DiffPane`, `attachPty`, and `createTimelineWindow` |
| `@acorn/plugin-api/ui/diff` | The `CodeRow` type, the `DiffSource` port, line context, the diff-document types, and `createDiffSnippets` ([the diff document](../diff-rendering/document.md)) |
| `@acorn/plugin-api/ui/host` | Compiled-shell-only connected components, composed controls, and the confirmation seam. Never import it from a frame |
| `@acorn/plugin-api/ui/editor` | The host-owned CodeMirror theme, view state, and `languageForPath`. Compiled panes only. The terminal client aliases it to a stub ([host switch](../tui/host-switch.md)) |
| `@acorn/plugin-api/ui/sdk` | The framework-free sandbox bridge, plus `mountFrame` and `mountTree` |
| `@acorn/plugin-api/ui/tree` | The kit as nodes a remote tree writes in JSX, and the Solid adapter behind them |
| `@acorn/plugin-api/ui/tokens` | `HOST`, the host this build draws on |
| `@acorn/plugin-api/ui/dashboards` | The dashboard panel card for an agent's `panel_show` call |
| `@acorn/plugin-api/ui/data-sources` | Connected typed-data authoring components |
| `@acorn/plugin-api/ui/model-provider-failure` | Shared model-provider failure presentation |
| `@acorn/plugin-api/testkit` | A real plugin context and request context, temporary databases, the auth gate, core's tables for fixtures, and the manifest validator |
| `@acorn/plugin-api/testkit/client` | The client half of the same, including the two extension registries a plugin's jsdom test reaches |
| `@acorn/plugin-api/testkit/ws-client` | WebSocket client test helpers |

Compiled client plugins can call `createWorkspaceWords()` in a Solid owner. It returns a reactive
accessor with `singular`, `plural`, `capitalized`, and `capitalizedPlural` for the active Node's
project grouping mode. The shared forms are readonly. Read the accessor where the text is drawn,
including command title and hint
functions, so switching between Nodes updates the words. `workspaceWords(mode)` provides the same
forms for callers that already hold a mode accessor. Both are exported beside
`workspaceForProject`; neither changes workspace IDs, routes, or stored scopes.

The runtime draws the line between `/client`, `/ui`, and `/ui/host`. Solid compiles a component to
code that touches `window` at module scope, so `/client` holds no `.tsx`. The `/ui` barrel holds
presentation components. Router, query, and registry-connected components, and composed controls
such as `ModelPickerPopover`, sit on `/ui/host`. The facade is declared side-effect free, so a frame
bundle keeps only the components it imports.

That doesn't hold inside the desktop shell. The client-core modules behind `/ui/host` create stores
when they load, so the bundler keeps every one of them once a module imports any name from the
barrel. Code that runs while a compiled plugin registers, such as a pane model, imports from
`/client`. Until October 9, 2026, one keybinding import from the changes model loaded the
loaded-plugin frame host, worker host, and promotion modal before the workspace could restore
([startup budget](../frontend/startup-budget.md)).

`packages/plugin-api/src/entrypoints.test.ts` imports every entrypoint except `/ui`, `/ui/host`, and
`/ui/editor` in a node-environment worker, the same shape a plugin's own suite runs in. That check
matters because the property is transitive: a `.tsx` module three imports behind `/client` breaks a
plugin's tests as surely as one in the barrel.

## Change the facade

Keep a facade name while a compiled consumer needs it. Prune a name only after checking imports
through the facade and direct imports of the same declaration. A `// prune candidate:` comment in the
facade source names a compiled consumer that should use a `ctx` seam instead. Once its callers move,
the export can leave.

`packages/plugin-api/src/surface.snapshot.txt` pins the facade's exported names. After you review an
addition or removal, run `UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`. The facade carries
no API major, so a compiled-only export can leave without changing the manifest contract.

A facade name is a seam core offers plugins in general, or a registry with one contributor so far.
Code that only one plugin uses and core doesn't belongs in that plugin, or in its `contract/` folder
when another package needs it. `tools/arch/facadeConsumers.test.ts` fails on a name that nothing
outside the facade imports, tests included. Closed-kit nodes are exempt, because the support matrix
holds that list. Run `node tools/arch/facadeConsumers.ts` to see who imports each name.

## One vocabulary across the registries

One shape means one verb, on both contexts:

| Shape | Verbs | Where |
| --- | --- | --- |
| Many entries, host collects | `register` | Routes, tools, schedules, data sources, task checks, context sections, runs, and every client contribution point |
| One owner declares a place, anyone fills it, the owner reads it | `declare`, `handle`, `handlers` | `ctx.extensionPoints`, `ctx.hooks` |
| One provider, resolved late | `provide`, `get`, `require` | `ctx.capabilities` and its client twin |
| A registry with one action beside its registration | The action's own verb | `audit.record`, `hooks.run`, `events.send` |

`ctx.providers` keeps four separate names: `integration`, `connection`, `model`, and `nodes`. A
single `register({ kind })` would need the four shapes to share a discriminant, and they don't. An
integration takes a descriptor and an optional route carrier, a model adapter names a registered
connection provider, and a node provider's `create` requires a `destroy`.

## The two contexts, one per tier

There are two node context types, declared in `packages/node-core/src/server/pluginHost/types.ts`:

- `NodePluginContext` is what a plugin loaded from disk receives. It has one member per contribution
  kind the loaded tier has.
- `CompiledNodePluginContext` adds what only a plugin compiled into this binary gets:
  `routes.register` with a live Hono instance, `routes.loopback`, `tools`, `contextSections`, `events.channel`,
  `events.streams`, and `search`, plus the compiled shapes of `core` and `schedules`.
  [Contribution kinds](../contribution-kinds.md) says why, kind by kind.

Reaching for a compiled-only member from a loaded plugin is a `tsc` error. A third type,
`HostPluginContext`, holds the node actions, harnesses, and custom agents the host replays from a
manifest. It stays off both authoring types, because no plugin writes those calls.

`CompiledCoreServices` owns checkout admission, repository metadata writes, security diagnostics,
and secret publication. Loaded plugins receive the permission-scoped `CoreServices` type, including
tool provenance verification when granted `agent-tool-provenance`.

`packages/client-core/src/host/registries/extensionPoints/plugin.ts` splits the client the same way,
into `ClientPluginContext` and `CompiledClientPluginContext`. A loaded plugin's client half is a
manifest plus a tree or a frame, so it never receives either object.

`ctx.telemetry` and `ctx.log` are on both tiers and need no permission. The host's revocation pass
skips them, so a context left over from a reload keeps logging under its own name instead of
throwing. A logger that throws would break the rule that telemetry never fails the work it
describes ([telemetry](../telemetry.md)). Reading the telemetry stream is the separate `telemetry`
core facet.

## Loopback routes

`ctx.routes.loopback({ prefix, target })` shows one of the Node's own loopback ports to a paired device, such as a
task's dev server. `target(params)` gets the route's path parameters and answers a port, or `null` for none. The
plugin supplies the port and nothing else. Core owns the rules (`packages/node-core/src/server/proxy/`):

- Only a paired device may use it. A task's token and the Node's own service get `403`.
- It connects to `127.0.0.1`, then `::1`, at the port. It resolves no name, and refuses the Node's own port.
- It streams both ways, follows no redirect, and rewrites a `Location` on the dev server's own address into a
  path. It drops `Authorization`, `x-acorn-internal`, and the preview grant cookie, sets `Host` to
  `localhost:<port>`, and rewrites `Origin` and `Referer` from the caller's origin to the dev server's.

Core mounts `/v1/p/<plugin><prefix>/*` for them. It also mounts `POST /v1/p/<plugin><prefix>/__acorn/open`, which opens
the same port as a preview a phone's browser can load. The preview plugin registers it at
`/tasks/:taskId/proxy`. A loaded plugin has no `loopback`, the way it has no `register`. A WebSocket upgrade on the
authenticated route isn't taken yet. A phone's page reaches the dev server's hot reload socket through its own
preview name instead.

## Hono and drizzle cross into tier 1 on purpose

`PluginRouteRegistry.register` takes a `Hono<AppEnv>`, and `PluginDatabase` is a drizzle handle. A
compiled plugin shares the host's HTTP framework and query builder by construction. That stays,
because abstracting either means writing a routing layer and a query layer of our own.

The loaded tier draws the line in two places:

- **Routing is neutral.** A loaded plugin serves `ctx.routes.fetch`, a `Request` in and a `Response`
  out. The loaded packages that build routes with Hono bring their own copy.
- **Storage has a neutral lifecycle and a drizzle handle.** `ctx.storage.open()` means the host owns
  the filename, the migration run, and the close. What it returns is still a drizzle handle, so
  `database` and `http` declare `drizzle-orm` as their own dependency.

Nothing new should push a framework across the loaded-tier boundary. If a third-party author needs
more, widen these two carriers. `@acorn/protocol`, the shared wire-type package, stays outside the
facade and is imported directly.
