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
| `@acorn/plugin-api/node` | `NodePlugin`, the route toolkit (`AppEnv`, `requireUser`, `respondError`, `portableCarrier`), the `PluginDatabase` handle type, `CoreServices` with its `ProjectRef` and `TaskRef` projections, `capabilityId`, and provider and integration contracts |
| `@acorn/plugin-api/client` | `ClientPlugin`, the API client and query options, client events, contribution types, task, workspace, and fleet state, the design system's plain functions, and `readLocal`, `writeLocal`, and `clearLocal` for per-device scraps such as an unsent draft |
| `@acorn/plugin-api/ui` | Frame-safe presentation components from the kit, the diff rows, `DiffPane`, `attachPty`, and `createTimelineWindow` |
| `@acorn/plugin-api/ui/diff` | The diff row model, highlighter, find marks, the `DiffSource` port, the diff-document types, and `createDiffSnippets` ([the diff document](../diff-rendering/document.md)) |
| `@acorn/plugin-api/ui/host` | Compiled-shell-only connected components, composed controls, and registration seams. Never import it from a frame |
| `@acorn/plugin-api/ui/editor` | The host-owned CodeMirror theme, view state, and `languageForPath`. Compiled panes only. The terminal client aliases it to a stub ([host switch](../tui/host-switch.md)) |
| `@acorn/plugin-api/ui/sdk` | The framework-free sandbox bridge, plus `mountFrame` and `mountTree` |
| `@acorn/plugin-api/ui/tree` | The kit as nodes a remote tree writes in JSX, and the Solid adapter behind them |
| `@acorn/plugin-api/ui/tokens` | The role enums and the node support matrix as data |
| `@acorn/plugin-api/ui/data-sources` | Connected typed-data authoring components |
| `@acorn/plugin-api/ui/model-provider-failure` | Shared model-provider failure presentation |
| `@acorn/plugin-api/testkit` | A real plugin context and request context, temporary databases, the auth gate, core's tables for fixtures, and the manifest validator |
| `@acorn/plugin-api/testkit/client` | The client half of the same, including the two extension registries a plugin's jsdom test reaches |
| `@acorn/plugin-api/testkit/ws-client` | WebSocket client test helpers |

The runtime draws the line between `/client`, `/ui`, and `/ui/host`. Solid compiles a component to
code that touches `window` at module scope, so `/client` holds no `.tsx`. The `/ui` barrel holds
presentation components. Router, query, and registry-connected components, and composed controls
such as `ModelPickerPopover`, sit on `/ui/host`. The facade is declared side-effect free, so a frame
bundle keeps only the components it imports.

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

## One vocabulary across the registries

One shape means one verb, on both contexts:

| Shape | Verbs | Where |
| --- | --- | --- |
| Many entries, host collects | `register` | Routes, tools, schedules, data sources, task checks, context sections, runs, and every client contribution point |
| One owner declares a place, anyone fills it, the owner reads it | `declare`, `handle`, `handlers` | `ctx.extensionPoints`, `ctx.hooks` |
| One provider, resolved late | `provide`, `get`, `require` | `ctx.capabilities` and its client twin |
| A registry with one action beside its registration | The action's own verb | `audit.record`, `hooks.run`, `events.send` |

`ctx.extensionPoints` still accepts the deprecated `open`, `contribute`, and `entries`. They're
aliases of the same implementation and leave at the next `PLUGIN_API_MAJOR`.

`ctx.providers` keeps four separate names: `integration`, `connection`, `model`, and `nodes`. A
single `register({ kind })` would need the four shapes to share a discriminant, and they don't. An
integration takes a descriptor and an optional route carrier, a model adapter names a registered
connection provider, and a node provider's `create` requires a `destroy`.

## The two contexts, one per tier

There are two node context types, declared in `packages/node-core/src/server/pluginHost/types.ts`:

- `NodePluginContext` is what a plugin loaded from disk receives. It has one member per contribution
  kind the loaded tier has.
- `CompiledNodePluginContext` adds what only a plugin compiled into this binary gets:
  `routes.register` with a live Hono instance, `tools`, `contextSections`, `events.channel`,
  `events.streams`, and `search`, plus the compiled shapes of `core` and `schedules`.
  [Contribution kinds](../contribution-kinds.md) says why, kind by kind.

Reaching for a compiled-only member from a loaded plugin is a `tsc` error. A third type,
`HostPluginContext`, holds the node actions, harnesses, and custom agents the host replays from a
manifest. It stays off both authoring types, because no plugin writes those calls.

`packages/client-core/src/host/registries/extensionPoints/plugin.ts` splits the client the same way,
into `ClientPluginContext` and `CompiledClientPluginContext`. A loaded plugin's client half is a
manifest plus a tree or a frame, so it never receives either object.

`ctx.telemetry` and `ctx.log` are on both tiers and need no permission. The host's revocation pass
skips them, so a context left over from a reload keeps logging under its own name instead of
throwing. A logger that throws would break the rule that telemetry never fails the work it
describes ([telemetry](../telemetry.md)). Reading the telemetry stream is the separate `telemetry`
core facet.

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
