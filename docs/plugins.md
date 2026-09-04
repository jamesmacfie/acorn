# Plugins

Plugins come in two tiers. Built-ins are first-party packages compiled into acorn and registered by
the Node/client composition roots. Loaded plugins are installed at runtime from a manifest plus ESM
bundles. Either tier can contribute Node behavior, client behavior, or both; the available carriers
and trust boundary differ by tier.

This file is the mechanism. [extensibility.md](./extensibility.md) is the reasoning — why there are
two tiers, where the line between them is, and which of the constraints below are deliberate rather
than unfinished. Read it before widening a seam.
[plugin-authoring.md](./plugin-authoring.md) is the subset of this file an author needs to write a
loaded plugin **by hand, with no build step** — plain multi-file ESM on the node, one vanilla-JS file
in the frame — with a complete worked example.

## Package shape

Every plugin, either tier, has the same shape and declares only the parts it has.

```text
plugins/<name>/
  acorn-plugin.config.mjs   loaded tier only; the build script generates the manifest from it
  migrations/               the Drizzle chain, paired with src/node/schema.ts
  src/
    node/       index.ts, the NodePlugin factory, and schema.ts. Nothing else.
    server/     routes/*.ts Hono routers, engines, stores, drivers, the vendor client
    client/     index.ts, components, <plugin>Client.ts, *Store.ts, contributions
    tree/       loaded tier only: the remote component tree the host draws
    contract/   only what another package imports. No tests.
    shared/     wire types, api.ts route builders, anything both halves read
    testkit/    index.ts for node-side tests elsewhere, client.ts for client-side
  tsconfig.json     { "extends": "../tsconfig.base.json", "include": ["src"] }
  vitest.config.ts  export { default } from '../vitest.shared'
  drizzle.config.ts export { default } from '../drizzle.shared'   (table-owning plugins only)
```

The exports map has five kinds, and a plugin declares the ones it has: `./node/index.ts` for the Node
activation entrypoint, `./client/index.ts` for the client one, `./contract/*` for the cross-plugin
surface, `./testkit` for node-side test helpers, and `./testkit/client` for client-side ones.

**`contract/` holds only what another package imports; `shared/` holds what both halves of this plugin
read.** That is the whole rule, the arch test enforces the first half, and a test file never belongs
under `contract/`. If you are unsure which folder a module goes in, ask whether anything outside this
package imports it: if nothing does, it is `shared/`. The rest of the naming rules are in
[conventions.md](./conventions.md).

The three config files are one line each on purpose. They were forty-two byte-identical copies, so the
content moved to `plugins/tsconfig.base.json`, `plugins/vitest.shared.ts` and
`plugins/drizzle.shared.ts` and each package keeps only the pointer — the same reasoning as
`tsconfig.base.json` at the workspace root, and all three are in `turbo.json`'s `globalDependencies` so
editing one invalidates every plugin's cached lint and test. `include` stays in each plugin's tsconfig
because TypeScript resolves a relative path against the file that declares it, so hoisting it would mean
seventeen packages typechecking nothing. `package.json` is not hoistable — npm has no `extends` — and
its identical `exports`/`scripts` blocks stay copied rather than generated.

"Shell-free" in `node/` and `server/` is about what loads, not about taste: `apps/node` imports every
plugin's `node/index.ts`, and an entrypoint evaluates every module behind it, so one module that
reaches for something only the desktop bundle has kills the standalone node at link time, before a
line of it runs. The composition-root suites under `apps/node/test/integration/` boot that graph, so
the commit that breaks it fails there. Nothing in `server/` reaches for a shell: the folder picker the terminal plugin used to own is a Tauri command, and the preview pane
is a child webview the shell drives (`docs/shell.md` § Host-owned webviews).

Not every plugin has every directory. The built-in Claude, Codex, and Aider profiles are registered
by `plugins/agents`; there are no separate profile packages. Onboarding is a client overlay with
core setup support; its client entry is a plain `index.ts` like every other plugin's, because a module
that only registers a lazy component builds it with `createComponent` and needs no JSX. The loaded Linear and Rollbar packages are integration providers that use core's
generic external-item store rather than owning a plugin database; a loaded plugin's UI lives in
`tree/` rather than `client/`, because it is a bundle for a sandboxed document and not a
`ClientPlugin`.

## The plugin API

`packages/plugin-api` (`@acorn/plugin-api`) is the only host package a plugin's production code may
import. It adds no behavior of its own: it re-exports an enumerated slice of node-core and
client-core, and `tools/arch/boundaries.test.ts` enforces both halves of that — plugins reach the
host only through the facade, and the facade only re-exports.

**A name is on it because something imports it.** Not because it might be useful — a contract is a promise
about what will not change, and a promise nobody asked for is one you can only break. Seventy-one names
came off in one pass on 2026-08-14 — 441 pinned names down to 371, with `TaskRef` the single addition —
each verified free by counting its consumers two ways: imports through the facade, and imports of the
same declaration by the deep-import baseline that first-party tests are still migrating off. A name with
zero on both went; a name reached only by a deep
import stayed, because deleting it strands a migration rather than removing dead weight. The one
deliberate exception is `PLUGIN_API_MAJOR`, which is the contract's version and is therefore on the
surface by definition. Anything that turns out to be missing is one line to add back, under the
add-is-free rule below.

Adding a name is mechanically free, but it is still a compatibility promise the moment a third-party
plugin exists. The 2026-08 architecture review flagged the client barrel's 173 exports at the time as
accumulated rather than chosen, so a new addition to `/client` or `/node` should face the same
question a new dependency gets: does a third-party plugin need this, or is it convenient for a
first-party one that could import deeper instead?

A comment marked `// prune candidate:` in the facade source flags a name that a first-party plugin
still reaches for but a third-party plugin should not. It names the `ctx` seam that plugin should
move to instead, so the marked name can come off the surface once every first-party caller has
moved onto that seam.

Eleven entrypoints:

| Entrypoint | What it carries |
| --- | --- |
| `@acorn/plugin-api/node` | `NodePlugin`, the route toolkit (`AppEnv`, `requireUser` and friends, `respondError`, the bridge, `portableCarrier`), the `PluginDatabase` handle type, `CoreServices` with its `ProjectRef`/`TaskRef` projections, `capabilityId`, provider and integration contracts |
| `@acorn/plugin-api/client` | `ClientPlugin`, the API client and query options, client events, contribution types, task/workspace/fleet state, the design system's plain functions (`token`, the metrics, the status/display vocabulary), and `readLocal`/`writeLocal`/`clearLocal` for a per-device scrap such as an unsent draft |
| `@acorn/plugin-api/ui` | Frame-safe presentation components: primitives (including the `ListDetail` two-column pane layout), `Icon`, `Picker` and its `PickerRow` for a list that opens from typing rather than from a button, `Menu` and its `RowActions` wrapper for the ellipsis menu on a list row, `Modal`, `Tabs`, `Markdown`, the diff rows, and `DiffPane` for the whole diff viewer. Also `attachPty`, which fills a `pty` rectangle from the channel the caller describes rather than from a box the host hands back ([terminal.md § Client](./terminal.md)) |
| `@acorn/plugin-api/ui/diff` | The diff model, virtualizer, hydration and find pass, plus the `DiffSource` port `DiffPane` is driven through |
| `@acorn/plugin-api/ui/host` | Compiled-shell-only connected components and registration seams; never import this from an isolated frame |
| `@acorn/plugin-api/ui/editor` | The host-owned CodeMirror surface: the theme, the view-state pair, and `languageForPath`, which is async because it downloads one grammar. Compiled panes only. The terminal client aliases it to a stub, because cells have no highlighter ([tui.md](./tui.md) § The host switch) |
| `@acorn/plugin-api/ui/sdk` | The framework-free sandbox bridge, including API/state/UI calls and declared key claims, plus `mountFrame` and `mountTree`, the two render paths' entry points |
| `@acorn/plugin-api/ui/tree` | The kit as nodes a remote tree writes in JSX, and the Solid adapter behind them. A tree imports this and never the `/ui` barrel |
| `@acorn/plugin-api/ui/tokens` | The role enums and the node support matrix as data, with no components on them |
| `@acorn/plugin-api/testkit` | Test scaffolding: a real plugin context and request context, temp-directory databases, the auth gate, core's tables for seeding fixtures, and the manifest validator |
| `@acorn/plugin-api/testkit/client` | The client-side half of the same, including the two extension registries a plugin's own jsdom test reaches |

The line between `/client`, `/ui`, and `/ui/host` is drawn by the runtime, not by taste. Solid
compiles a component to code that touches `window` at module scope, so `/client` remains free of
`.tsx`. The frame-safe `/ui` barrel reaches only the pure `client-core/src/kit/` presentation tree;
router/query/registry-connected components sit on `/ui/host`. The facade is declared side-effect
free so a frame bundle retains only the named presentation components it imports.

Boundary tests grep for those properties, and `packages/plugin-api/src/entrypoints.test.ts` executes
them: it imports every entrypoint except `/ui`, `/ui/host` and `/ui/editor` in a node-environment
vitest worker, which is the same shape a plugin's own suite runs in. That is the check that matters,
because the property is transitive — a `.tsx` module three hops behind `/client` breaks a plugin's
tests just as thoroughly as one named in the barrel — and it doubles as enforcement of the
side-effect-free claim.

`packages/plugin-api/src/surface.snapshot.txt` pins every exported name. A change to the surface
fails that test until the snapshot is regenerated
(`UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`), which is the point: growing the contract
should be a deliberate act. The implementation still lives in
`packages/node-core/src/server/pluginHost/types.ts` and
`packages/client-core/src/host/registries/extensionPoints/plugin.ts`, which stay free to move files around underneath.

**Adding a name is free. Removing one is a major bump.** The snapshot's first line records the
`PLUGIN_API_MAJOR` it was written under, and regeneration REFUSES to drop a name while that major is
unchanged — it prints the names that would vanish and tells you to bump or put them back. That is not a
style rule: a manifest's `apiVersion` range is checked at plugin load, at install, and at client bundle
resolution, so a plugin built against a surface that has since lost a name does not degrade gracefully, it
fails to resolve a symbol at run time in someone else's process with no version having said so. Bumping
without regenerating fails the same test, so the pair cannot drift apart in either direction. Bumping
means editing `packages/protocol/src/plugin/apiVersion.ts` and rebuilding every loaded package
(`pnpm --filter @acorn/node build:plugin <id>` per package, plus
`pnpm --filter @acorn/desktop run build:bundled-plugins`) — a stale package keeps the old number and stops
loading. The major went to `2` on 2026-08-14, when the facade shed seventy-one names, and to `3` on
2026-08-27, when four names moved to say what they mean: `capabilities` became `hostCapabilities`,
`PollerContribution` became `ClientScheduleContribution`, and the two slot registries folded into one.
It went to `4` on 2026-08-28, when `ctx.events` lost `notice` and `stepEvent` to the `workflows.notices`
capability, a loaded plugin's capability ids became bound to its own namespace, and its pane, source and
slot ids did too. The same `4` batch then took `hostCapabilities` and the `HostCapabilities` type: a
contribution's `requires` used to be a closed union with one plugin's name, `terminal`, compiled into
core, and it is now `'desktop' | { plugin: id } | { seam: group }` or an array of them, answered by
`hasHostCapability` (2026-08-27 extensibility review, finding 8; the seam form arrived on 2026-08-31,
docs/frontend.md § The desktop gate audit). Every bump was batched deliberately — a rename is cheap
while every plugin is in this repository and expensive the moment one is not, and the `4` batch was the
last window before the namespace rules would have had to grandfather an ecosystem.

It went to `8` on 2026-08-31, when `memorySection`, `notesSection` and `pullRequestSection` came off
`/node`. Those three built a plugin's own context section inside core, so core knew three plugins by
name to hand them back their own rows. Each now lives in the package that owns the rows, and what the
facade offers instead is the arithmetic they shared: `truncateBytes`, `formatOmitted`, and the
`PluginContextSection` type.

It went to `9` on 2026-08-31, when the editor moved off Monaco. `ui/editor` published three names
that said Monaco out loud — `MONACO_THEME`, `watchMonacoTheme`, `monacoLanguageForPath` — and a
theme name is not a thing CodeMirror has. What the entrypoint offers instead is `editorTheme`,
`refreshEditorTheme` and `watchEditorTheme` (an extension, a re-read and a subscription),
`languageForPath`, and the view-state pair
`captureViewState`/`applyViewState` with its `EditorViewState` type, which is the selection and
scroll a pane used to hand back to a library as an opaque blob.

It went to `10` on 2026-09-03, when the command palette stopped having two vocabularies.
`PaletteRowSource` and `PaletteItem` came off `/client` with the registry behind them: a second way to
put a row in the palette, with `rows` and `invoke` where a command has `run`, and with no owner, no
capability gate, no disposal and no shortcut of its own — each of those had to be arranged for it
separately. Only a compiled plugin could supply its callbacks, so a loaded plugin could never
contribute a live row through it at all. Its last two contributors, the terminal's run targets and the
workflow definitions, are `search` commands their plugins register through `ctx.commands`
([command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)). `ctx.paletteRows` went with
them. The manifest's `contributions.palette` alias did **not**: it names a command rather than a row,
it has always been read as one, and its removal is a separate announcement rather than something this
batch could carry quietly.

**Folding a removal into an open batch is a judgement, not a loophole.** The snapshot guard compares the
committed major against the current one, so it cannot tell "this major already shipped" from "this major
was bumped an hour ago in the same uncommitted change". Nothing had been released under `4` when the
`requires` removal landed, so it joined the batch and is recorded in the paragraph above rather than
buying a `5` nobody could have been running. Once a major is out, the guard's two remedies — put the
name back, or bump — are the only two.

### One vocabulary across the registries

Every registry on `ctx` used to pick its own verb, and each pick was defensible on its own. Together
they were a lookup table an author kept open: `register` on most of them, `declare`/`record` on audit,
`open`/`contribute`/`entries` on extension points, `declare`/`handle`/`run` on hooks,
`provide`/`get`/`require` on capabilities, and five bespoke names on providers. One shape now means one
word, on both contexts:

| Shape | Verb | Where |
| --- | --- | --- |
| Many entries, host collects | `register` | routes, tools, schedules, collections, task checks, context sections, runs, node actions, harnesses, and every client contribution point |
| One owner declares a place, anyone fills it, the owner reads it | `declare`, `handle`, `handlers` | `ctx.extensionPoints`, `ctx.hooks` |
| One provider, resolved late | `provide`, `get`, `require` | `ctx.capabilities`, and its client twin |
| A registry with one action call beside its registration | keep the action's own verb | `audit.record`, `hooks.run`, `events.send` |

`ctx.extensionPoints` is the one that moved: `open` became `declare`, `contribute` became `handle`, and
`entries` became `handlers`, so the many-to-many seam reads the same as hooks, which is the same shape
asked a different question. The three old names are still there, marked deprecated, and they are aliases
rather than wrappers — same implementation, same registry, same disposal. They come off at the next
`PLUGIN_API_MAJOR`, which is what gives a plugin outside this repository a release of its own to move in.

**`ctx.providers` keeps its four bespoke names**, and that is a decision rather than an oversight. A
single `providers.register({ kind, … })` needs the four shapes to share a discriminant, and they do not:
`integration` takes a descriptor plus an optional route carrier, `model` takes an adapter that names an
already-registered connection provider, and `nodes` takes a contribution whose `create` obliges a
`destroy`. Folding them would trade four honest signatures for one union with four ways to be wrong.

### The two contexts, one per tier

There are two node context types, and the difference between them is the difference between the tiers:

- **`NodePluginContext`** is what a plugin loaded from disk is handed. It has one member per
  contribution kind that tier actually has.
- **`CompiledNodePluginContext`** is `NodePluginContext` plus the six seams only a plugin compiled into
  this binary gets: `routes.register` (a live Hono instance), `tools`, `contextSections`,
  `providers.model`, `events.channel` and `events.streams`.
  [contribution-kinds.md](./contribution-kinds.md) says why, kind by kind, and what would have to be
  true for one to move.

`packages/client-core/src/host/registries/extensionPoints/plugin.ts` splits the client's the same way,
into `ClientPluginContext` and `CompiledClientPluginContext`, though there the split is for honesty
rather than for a caller: a loaded plugin's client half is a manifest plus a tree or a frame and is never
handed the object at all.

This was one type with per-member comments until 2026-08-31, and the comments were the only thing saying
which tier got what. Reaching for a compiled-only member from a loaded plugin compiled fine and failed at
run time as "not a function", which is a bad way to learn a rule. It is a `tsc` error now.

`packages/plugin-types/src/public.ts` — the declarations acorn publishes as `acorn-plugin-types` — is the
published twin of the loaded type, and `contract.test.ts` holds the two equal member for member. Adding a
member to one and not the other fails that test, which is what stops the hand-written copy from quietly
falling behind the host it describes.

### What is published, and what acorn promises about it

Three packages leave this repository. All are unscoped, which is a decision and not a placeholder:
`@acorn/*` would need an npm organisation that does not exist, and nothing about these artifacts is
improved by waiting for one.

| Package | What it is |
| --- | --- |
| `create-acorn-plugin` | The scaffold (`packages/create-acorn-plugin`). Emits the whole no-bundler profile; depends on nothing, including this list's other entries. |
| `acorn-plugin-sdk` | The sandbox bridge (`packages/plugin-sdk`) — `connect`, `mountFrame`, `mountTree`, `openLinkOnClick`, `AcornBridgeError` and the `AcornBridge` type, re-exported from `@acorn/plugin-api/ui/sdk` so the two cannot drift. Its `/remote` subpath is `@acorn/plugin-api/ui/tree`, for a tree written in JSX. |
| `acorn-plugin-types` | The node-side API as declarations (`packages/plugin-types`), plus the generated manifest schema. No runtime, and `@types/node` as its only peer. |

**Only the sandbox bridge and the declarations are published, and the eleven entrypoints never will be.** They re-export
node-core and client-core — Hono, drizzle, Solid, Monaco — and a plugin does not want a second copy of
any of those. It wants the host's, which a compiled plugin gets from the builder and a loaded plugin
gets through `ctx` and through the document its frame is served in. The bridge is the one thing an
out-of-tree author cannot obtain any other way, because the alternative is copying a handshake. That
also keeps the published bundle honest: 17 kB, seven modules, zero external imports, and a test that
imports it in a bare node environment so the day someone re-exports a Solid component it fails here
rather than in a stranger's bundler.

**The promise: a plugin that loads under `PLUGIN_API_MAJOR` keeps loading under it.** That is what
publishing converts from an internal invariant into something owed to someone else, and it is the same
invariant the snapshot already enforced — a removal requires the major to move.

A manifest's `apiVersion` is a **range over majors**, not a single number: `"3"`, `"2 || 3"`, or a span
like `"2-4"`. `speaksApiVersion` in `packages/protocol/src/plugin/apiVersion.ts` is the one comparison,
used by both loader paths, the installer, and the client's bundle resolution. It was an exact string
match until 2026-08-28, which meant a plugin could not support two majors and the day the number moved
every out-of-tree package stopped loading with no version an author could ship that worked on both
sides. Anything that is not a range reads as incompatible, so a typo fails at the manifest rather than
matching nothing quietly.

`requires.plugins` uses the same grammar for a different question. `apiVersion` says which acorn a
package speaks; `requires` says which *other packages* it needs on the node, checked at load and used
to order init ([plugin authoring](./plugin-authoring.md) § Requiring another plugin). It exists because
a plugin consuming another plugin's capability used to fail at whichever route reached for it first,
with a message about a missing capability and nothing naming the package that should have provided it.

What is *not* promised: that the major will never move, that a prior major keeps working once acorn
stops naming it, or that anything below carries a deprecation window. There is no deprecation program
and none is planned; the ceiling stays "the number cannot lie about a removal". The range is what gives
an author a way to cross a move, not a promise that they will not have to.

`packages/plugin-sdk/src/public.ts` is the published declaration, **hand-written** and copied verbatim
to `dist/sdk.d.ts`. Nothing here emits declarations — `noEmit` is global and every package is consumed as
source — so a rollup would mean adding a declaration build and API Extractor to describe six functions,
and it would drag `ErrorEnvelope`, and therefore Zod, into the published types for a shape that never
appears on the surface. Hand-written is also the better artifact for a compatibility promise: something a
person wrote and a person reviewed. It is held to the implementation by mutual-assignability assertions in
`packages/plugin-sdk/src/contract.test.ts`, which `tsc --noEmit` fails the moment an upstream shape moves
underneath a stable name — the exact drift the name-level snapshot cannot see.

`acorn-plugin-types` is the same arrangement one tier over, and it exists because the only kind of
plugin a stranger could write was untyped JavaScript against prose. `packages/plugin-types/src/public.ts`
is hand-written for the same reasons `public.ts` above is, copied verbatim to `index.d.ts`, and held to
the implementation by mutual-assignability assertions in `contract.test.ts`. A plugin picks it up with a
JSDoc annotation and no build step, which is what keeps the no-bundler profile intact:

```js
/** @param {import('acorn-plugin-types').NodePluginContext} ctx */
init(ctx) { … }
```

It describes the **loaded** tier, so `routes.register`, `events.channel` and `events.streams` are
absent: those are permanently first-party and a published declaration that named them would be
advertising something no installed package can reach. A handful of members carry a type it declares as
`HostOwned<…>` rather than describing — the drizzle handle behind `ctx.storage.open()`, the Zod schema
on an agent-tool contribution — because describing either means adding the dependency this package
promises not to have. Every one is a named line in `contract.test.ts`, and the count is asserted, so
the list can only grow on purpose.

### The manifest schema

The field-by-field reference is [plugin authoring](./plugin-authoring.md) § The manifest, and it is
the only one; this section is what the **host** does with the file it reads.

The host reads ten top-level keys. `id` names the package's route prefix, its directory under
`<dataRoot>/plugins/`, and its SQLite file. `name` is display text. `version` is what the installer's
downgrade guard compares. `apiVersion` is the range checked at load, at install, and at client bundle
resolution. `node`, `client`, and `migrations` are relative paths, each confined inside the package
directory both lexically and through symlinks. `requires` orders init and refuses a package whose
dependency is absent. `permissions` and `contributions` are the two declarations the trust dialog
renders and the registries read. Anything else in the file is ignored, which is what lets a manifest
written for a newer acorn load on an older one and contribute less.

`packages/plugin-types/acorn-plugin.schema.json` is the JSON Schema for `acorn-plugin.json`,
**generated** from `packages/protocol/src/plugin/contract.ts` and committed beside the declarations.
`pluginSchema.test.ts` regenerates it and fails when the committed bytes differ; regenerate with
`UPDATE_PLUGIN_SCHEMA=1 pnpm test`.

Generated is the whole argument. `docs/future/ecosystem/README.md` used to record a JSON Schema as
deliberately not built, because a second schema is a second source of truth — correct for a
hand-maintained copy, and not true of one a test rewrites from the contract. What it buys is the thing
prose cannot: an author gets completion and inline errors on every contribution array before the file
is ever loaded. The scaffold writes the `$schema` key, so a scaffolded plugin has it from the first
line.

`PLUGIN_BRIDGE_VERSION` (`packages/protocol/src/plugin/bridge.ts`) is not part of that published
surface. A frame never compares it itself: `connect()` does, and refuses a hello it does not
recognize. Exporting the number would invite a plugin to branch on it and claim it supports two
protocol versions, which is not a promise acorn makes.

### Hono and drizzle cross into tier 1 on purpose

**Hono and drizzle are part of the tier-1 contract, and that is a decision, not an oversight.**
`PluginRouteRegistry.register` takes a `Hono<AppEnv>` and `PluginDatabase` is
`ReturnType<typeof drizzleOverSqlite> & …`, so a compiled-in plugin shares the host's HTTP framework and
query builder by construction — thirteen plugins declare `hono` and eight `drizzle-orm` as their own
dependencies. That stays. Abstracting either means writing a routing layer and a query layer of our own,
which is a bigger and less useful thing than the coupling it removes, and first-party code in the same
binary sharing the host's frameworks is the normal case rather than a leak.

The loaded tier is where the line is drawn, and it is drawn in exactly one and a half places:

- **Routing: genuinely neutral.** A loaded plugin serves `ctx.routes.fetch` — a `Request` in, a `Response`
  out, with `portableCarrier` moving the request context across the boundary. Nothing in that signature
  names a framework. The four loaded packages that use Hono to build their routes bring *their own copy*;
  the host neither supplies nor requires it.
- **Storage: neutral lifecycle, drizzle handle.** `ctx.storage.open()` means the host owns the filename,
  the migration run and the close, so a plugin never picks a database path or discovers a chain by
  filesystem proximity. But what it hands back is still a drizzle handle, and `database` and `http` declare
  `drizzle-orm` because of it. That is the one framework that crosses into tier 2, said plainly rather
  than papered over. The ceiling on fixing it is the same as above — a query layer of our own — so it is
  not being fixed.

So: nothing NEW should push a framework across the tier-2 boundary, and the two carriers that already
exist are the ones to widen if a third-party author needs more.

One thing stays outside the facade: `@acorn/protocol`, the shared wire-type package, which is
imported directly.

### The testkit

Test code crosses the same seam as production code, through `@acorn/plugin-api/testkit`. That
entrypoint exists because the alternative was worse than a deep import: with no way to get a real
plugin context, every plugin forged one — `{ routes: { register: undefined }, … } as unknown as
NodePluginContext` — and a forgery cannot fail when the host's context changes, so those tests stayed
green against a shape that no longer existed.

`makeTestNodeContext({ plugin, permissions?, migrations? })` is therefore not a mock. It calls the
same `server/pluginHost/context.ts` the host calls at boot, over a temp data root, so which tier a test
gets — `routes.register` present or absent, core scoped or whole, storage bound or missing — is the
host's decision and not the test's. Its `cleanup()` runs the host's own registration rollback.
`makeTestRequestContext` does the same for a loaded plugin's fetch handler: the real
`PluginRequestContext`, with canned answers allowed on top for the provider calls a test cannot make
for real. Alongside them: `makeTestDb`/`makeTestPluginDb`, `testEnv`, `testGate`,
`seedProviderConnection`, core's `schema` for seeding fixtures, and `validatePluginConfig`, which runs
the real manifest schema over a plugin's `acorn-plugin.config.mjs` so a bad declaration fails in
`pnpm test` rather than at the next boot (`apps/node/test/integration/pluginSystem/pluginConfigs.test.ts` checks every one).

The testkit is node-environment safe by rule — no components, no `window` — because plugin vitest
configs are node-env and a barrel evaluates every module on it. First-party tests that still reach
node-core and client-core directly are a shrinking baseline in the boundaries suite, migrated as they
are touched; a new deep seam means the testkit is missing something, and the fix goes there.

## Activation

`apps/node/src/composition/plugins.ts` is the Node activation list. `apps/desktop/src/client/plugins.ts`
is the client activation list. The host validates unique names, applies the per-Node disabled-plugin
set, initializes enabled plugins, runs the optional ready/activation pass, and owns disposal of their
registrations.

Required plugins are agents, memory, notes, and terminal. GitHub is optional: when enabled it contributes
the provider, PR rail, importer, and mirror routes; when disabled core Home and the remaining plugins
still boot.

Optional plugins can be disabled per Node through Settings → Plugins; their SQLite files remain on
disk and can be re-enabled later.

Settings → Plugins, install included, is scoped to one Node at a time, with a node picker at the top.
Which plugins a Node runs decides which routes exist and which SQLite files it opens, so disabling a
plugin is a statement about one machine: a fleet is a set of independently administered nodes, and
there is no "install everywhere" or "disable everywhere" here.

The page shows two facts per row, not one: `disabled` is what will happen (it takes effect at the
Node's next start, since routes, tables, and jobs are wired at init) and `running` is what is happening
now. Between saving a toggle and restarting the Node, the two can differ, and the page keeps both
visible with a restart banner rather than collapsing them into one state that would either lie about
the checkbox or hide the pending restart. Install and update carry the same banner, for the same
reason: a package that installed onto the Node's disk has not necessarily started running yet.

Node initialization happens before the listener accepts requests. Every plugin's `init` runs at once,
and so does every plugin's `ready`, so **declaration order is not a contract**. A plugin whose `init`
reads what another plugin's `init` registered is a bug, and it was a bug before the passes overlapped:
disabling one plugin removes a step from the sequence, and the composition list is grouped by domain
rather than by dependency. Cross-plugin needs have two answers. Resolve a capability at call time,
inside the closure that needs it, which is what `ctx.capabilities.get` is for. Or read the other
plugin's contributions in `ready`, which is the pass that exists for exactly this and runs only after
every `init` has finished.

`initPlugins` proves the property with a test rather than a promise: it initialises one roster in
declaration order, reversed, and shuffled, and asserts the same registrations each time
(`packages/node-core/src/server/pluginHost/host.test.ts` § order independence).

Failure is per plugin. A built-in that throws in either pass fails the boot and every plugin that did
initialise is disposed first, because each holds a write-ahead-log SQLite handle and the composition
root releases the data-root lock on the way out. A plugin loaded from disk is contained instead: its
registrations roll back, its row reads `failed`, and its neighbours reach `ready`. The one thing that
changed when the passes started overlapping is which plugins have run by the time a failure is read.
All of them have, so all of them are torn down rather than the ones declared before the failure.

A plugin can register:

- routes under `/v2/p/<plugin>/...`;
- typed capabilities;
- client broadcasts through `ctx.events`;
- agent tools and task-context sections;
- integration, connection, and model-provider descriptors;
- a plugin-owned SQLite migration chain and disposal hook.

Two things a plugin CANNOT register, because they are the host's to write on its behalf: node actions
and managed-agent harnesses. Both come from the manifest — a command whose verb is `runNodeAction`, and
`contributions.harnesses` — and the host replays them through `HostPluginContext`, a shape
`server/pluginHost/types.ts` keeps deliberately off the authoring type. They sat on `NodePluginContext`
until 2026-08-27, reading as members an author should reach for, and across 21 plugins nobody ever did.

There is no `ctx.log` either. Two plugins used it and four reached past it for `console`, which is
interchangeable with it at every call site, so the seam bought no attribution and cost a member. Prefix
your own messages.

The host supplies `CoreServices` for confined filesystem access, Git, processes, secrets, tasks,
repositories, task context, model generation, preferences, and the machine identity. Plugins do not
receive the core database handle merely to query shared tables.

What `CoreServices` hands back for a core entity is a PROJECTION, never the row. `projects` answers with
`ProjectRef` — id, name, path, workspace, GitHub facet — and `tasks` answers with `TaskRef`: id, title,
projectId, branch, worktreePath, pullNumber, and nothing else. `tasks.load()` used to return
`typeof schema.tasks.$inferSelect`, which put core's own column names on the plugin contract: renaming a
column would have broken every plugin with no signal at all, because the surface snapshot pins names and
cannot see a type change shape underneath a stable one. The six fields on `TaskRef` are exactly what
plugin code reads; `icon`, `origin`, `status`, `parentId`, `sort`, `createdAt`, `updatedAt` and
`archivedAt` are read by nobody outside core and stay core's. `taskContext()` and the `WORKTREE_CREATED`
hook take a `TaskRef` too, so a plugin can hand back what it was given.

It supplies no HTTP client. This list named one, and none exists — see docs/http-client.md for why
that matters and when it will have to.

## Loaded plugins

A Node can also load a plugin's node half from disk, from `<dataRoot>/plugins/<id>/` — a directory
holding an `acorn-plugin.json` manifest and an ESM bundle that default-exports a `NodePlugin`. The
manifest's shape is declared once, in `packages/protocol/src/plugin/contract.ts`, because the client
registers contributions from the same shape and neither side may import the other;
`packages/node-core/src/server/plugins/manifest.ts` adds the cross-field rules that need `id` — route
confinement, surface reachability — and reads the file. Loaded plugins join the same
array and the same host passes as the compiled-in ones, so `ready`, capability late-binding and
disposal are identical, and order is no more load-bearing for them than for a built-in.

Three things differ, and all three follow from the code not being ours:

- **They get there through the installer.** `POST /v2/core/plugins/install` (owner/device principal,
  `Idempotency-Key` required, audited) resolves a GitHub release, an npm package, a tarball URL or a
  local folder; validates the manifest; and places the package atomically with a hash-pinned lockfile
  beside it — except for a folder, which is symlinked and therefore pins nothing
  ([security.md § Installing from a folder](./security.md)) (`packages/node-core/src/server/plugins/installer.ts`,
  docs/plugins.md). Uninstalling removes the package and, by default, leaves its
  SQLite file alone. Each device then asks its own owner before running the plugin's interface code.
  Nothing in that family starts a plugin — each answers "the disk now says this". The one exception is
  `POST /v2/core/plugins/:id/reload`, which swaps a loaded plugin's node half in the running process;
  see § The dev loop for its semantics and its four limits.
- **Failures are contained, and every failure names itself.** A built-in throwing from `init` still
  fails the boot — it is first-party code in the same binary, and a node that cannot assemble should say
  so. A loaded plugin throwing has its registrations rolled back, is reported through the roster
  (`state: 'failed'`) and the attention inbox, and the node keeps starting.

  A failed roster row carries `reason` and `stage` alongside `failedAt`. `stage` is `'init'` or
  `'ready'` for a plugin that ran and threw, and `'load'` for a package that never ran at all: a
  manifest that does not parse (the reason names the offending field paths, not just "does not match the
  schema"), an `apiVersion` this node does not speak, a `requires.plugins` entry naming a package this
  node does not have, an id a second directory already claims, a bundle that throws on import, a wrong
  default export. Those load failures used to end at a `console.error`
  in the node's stdout, which a packaged app shows to nobody — and a package whose bundle would not
  import read as `pending-restart`, with a Restart banner that restarting could never clear because
  restarting re-ran the same failing import. A load failure is now `state: 'failed'` with its reason,
  raises no banner, and a package the loader dropped before it could even be listed still gets a row.

  `reason` is a **loaded plugin's own text on its way to the owner's UI**: display-only, capped by the
  node, rendered as text and never as markup. Both fields are optional on the wire, so a client talking
  to an older node degrades to the generic sentence rather than to nothing. A load failure is a fact
  about the boot that observed it, so fixing the package on disk leaves the row reading `failed` with
  its original reason until the restart that re-reads it.
- **The context is shaped by the manifest.** `permissions.node` decides which `CoreServices` facets
  and capability ids the plugin can see. Which *members* it gets is not a manifest question at all: the
  answer is the `NodePluginContext` type in
  `packages/node-core/src/server/pluginHost/types.ts`, and everything missing from it is on
  `CompiledNodePluginContext` beside it (§ The two contexts, one per tier). A loaded plugin serves routes as
  `ctx.routes.fetch(handler)` instead — a `(Request, PluginRequestContext) → Response` function. A
  plugin that wants Hono anyway wraps its router in `portableCarrier(id)` from
  `@acorn/plugin-api/node`, which hands back the `portableFetch` wrapper and the matching
  `requestContext(c)` accessor; that pairing used to be fifteen pasted lines per plugin, and the four
  loaded plugins are its callers. The
  request context projects authenticated identity plus a provider runtime; it exposes provider-owned
  resource, connection and external-item operations without exposing Hono, the core database, or the
  secret service. The external-item calls exist for the read no per-connection resource can express —
  the same cached item across every connection of one provider, which is how a bare ticket id gets
  attributed to a workspace — and the host binds the owner and the provider ownership check. A
  loaded integration provider likewise passes a fetch handler to `ctx.providers.integration`; passing
  Hono is an explicit initialization error. Project access is deliberately three grants:
  `projects:read` for identity, checkout paths and workspace external-project mappings scoped to
  connection providers registered by that loaded plugin,
  `projects:config` for executable build/dev/database
  configuration, and `projects:write` for creating or updating project references. The `prefs` facet
  is projected into `plugin:<id>:*`, the same namespace used by that plugin's frame `state.get` and
  `state.set` verbs; this is the supported Node-half↔frame state channel. Values are capped at 1 MiB
  from either side.

That last point is least privilege for **cooperative** code and honest disclosure for users, not a
security boundary: a loaded bundle shares the Node's process and can `import('node:fs')` and ignore
`ctx` entirely. `docs/security.md` is the full threat model, and every surface that
renders these permissions has to say *declared*, not *enforced*.

`apps/node/scripts/build-plugin.mjs` builds a repository plugin into this shape, reading the plugin's
declaration from the plugin's own package — `plugins/<id>/acorn-plugin.config.mjs`, where the directory
name is the plugin id — so a plugin's declared surface lives, and is reviewed, beside the code it
describes. Its default target is
the development data root; `--package-root` stages the same package for distribution. The desktop
build keeps its bundled roster in `apps/desktop/scripts/build-bundled-plugins.mjs`, packages the
result as read-only application resources, and asks the service to reconcile it before discovery.
Only packages recorded as app-owned are updated. An existing owner-installed version wins, and
uninstall writes a tombstone outside the package directory so a later app update does not restore it.
An unrecorded directory sitting in the plugin root is treated as owner-installed too, with one
exception: a package `build:plugin` wrote straight into the data root leaves a `.acorn-dev-build`
marker, and reconciliation treats a marked package as app-owned so a newer bundled version replaces
it. Without that, a developer's own build was indistinguishable from an installation, was recorded as
user-managed, and then quietly outlived every rebuild of the app — which presents as a feature that
does not exist. The marker is never written under `--package-root`, so nothing in a shipped resource
directory carries it, and a real install is protected exactly as before. Because an owner-installed row
is still checked first — deliberately, so a marker file cannot override ownership — `build:plugin` also
clears a `user` row for the id it is writing: that row is a claim about how the directory got there, the
script is authoritatively changing that, and without this a developer already trapped by a pre-marker
build would stay trapped through any number of rebuilds. Under `--package-root` the script cannot clear
that row — the staged output is not going into that data root, and could be for a different machine's —
so it prints the row, the file and the fix instead. Both Node hosts also report every ownership row at
boot (`reconcileBundledPackages` in `apps/node/src/composition/composition.ts`), because reconciliation's
"declined to update" list can only name a package it had a newer copy of, and the whole failure mode is a
frozen package on a node that has no newer copy to decline.
Bundled client bytes are trusted only after the desktop helper reads and hashes its own application
resource directory; a node cannot acquire that trust by labelling a roster row as bundled.

A bundled package has no lockfile, so the node has no source to re-resolve and its update route can
only refuse. The roster row says so structurally (`installed.bundled` on `InstalledPluginRow`), and
Settings → Plugins uses that to show neither update nor uninstall on a bundled row: update would only
ever error, and the checkbox already covers "stop running this" without the tombstone that uninstall
leaves behind.

## The dev loop

Seeing a change to a loaded plugin run used to be four steps and a page of host knowledge: rebuild by
hand, restart the node, reload the renderer, answer a trust dialog per bundled package. Three of the four
are the host's business, so the host does them.

This is the loop for a **repository** plugin, which is built. A package written by hand has no build
step to watch and is installed by absolute path as a symlink, so the rebuild half does not apply —
[plugin-authoring.md](./plugin-authoring.md) is that contract and that loop.

```sh
pnpm dev:plugin rollbar     # rebuild the package on every save
pnpm dev:node               # and this restarts itself when the bundle changes
```

`pnpm dev:plugin <id>` (`apps/node/scripts/dev-plugin.mjs`) watches the plugin's `src/`, its
`acorn-plugin.config.mjs` and its migration chain, and re-runs `build-plugin.mjs` — a fresh process per
rebuild, so there is no module cache to invalidate. It builds wherever `build-plugin.mjs` would: the dev
data root by default, or `-- --package-root ../desktop/dist/bundled-plugins` to write into the desktop's
staging directory instead, which is the one to use when iterating on a **bundled** plugin's frame under
`pnpm dev` (that directory is the copy the app trusts and reconciles from).

A malformed `acorn-plugin.config.mjs` no longer waits for a rebuild or a boot to announce itself:
`validatePluginConfig` (`@acorn/plugin-api/testkit`) runs the real manifest schema over it, and
`apps/node/test/integration/pluginSystem/pluginConfigs.test.ts` does that for every loadable plugin at `pnpm test` time.

The node restart is the step that is real rather than ritual: a loaded plugin's routes, tables and jobs
wire at init, so a rebuilt bundle is not live until the node re-runs it. Under `pnpm dev:node` node's own
`--watch` sees the rewritten bundle and restarts for you. Under the desktop, use Settings → Plugins →
Restart: it re-runs reconciliation and reloads the renderer, which is the other half — frame
contributions resolve once per session, so the client has to re-ask.

### Reloading one plugin without a restart

`POST /v2/core/plugins/:id/reload` (owner/device principal, `Idempotency-Key` required, audited) swaps
one **loaded** plugin's node half in the running process. Built-ins are refused with a 400: they are
compiled into the binary, so there is no second copy on disk to swap in, and their restart-required flow
already works.

The semantics are **candidate-then-commit**. The new bundle's `init` runs against a *buffered*
registration set rather than the live registries, because every registry here rejects a duplicate — tool
names, provider ids, capability ids — and the previous instance is still in all of them. So if `init`
throws, nothing moved: the previous instance is still registered, still serving and still holding its
database, and the failure lands as `state: 'failed'` with its `reason` on the roster row, exactly like a
contained failure at boot. The route answers **200 with `state: 'failed'`** for that, not an error — the
request did nothing wrong and nothing was lost. Only on success does the host clear the previous
registrations, run its `dispose`, close its database, revoke its context and replay the buffer.

Four limits, all deliberate:

- **A revoked context throws.** After a swap, anything reached through the previous instance's `ctx` —
  a registration, a broadcast, `storage.open()` — throws rather than writing through a plugin that is no
  longer running. `ctx.core` and `ctx.capabilities.get` stay live: they are host services that did not go
  anywhere.
- **Only the entry module is re-evaluated.** Node caches an ES module permanently by resolved URL, so the
  loader stamps a generation onto the entry's file URL (`?load=<n>`) when a reload names it. A relative
  specifier *inside* that module resolves against the URL's path and does not inherit the query, so
  `./chunk.js` comes back from the cache with the code it had at boot. A single-file node half — the
  authoring profile — is fully covered; a multi-file one needs a restart for a change that lands outside
  the entry file, until a `module.register` resolve hook stamps the whole subgraph.
- **Registration rollback is not schema rollback.** The candidate's `init` may open and migrate the
  plugin's database, mid-process, before it fails. The host puts every registration back; it cannot
  un-migrate. The author iterating on the plugin owns the data whose shape they just changed.
- **An invalid registration fails inside the commit window.** Two tools sharing a name, or a provider
  that fails its shape check, can only be found when the buffer is replayed — the registries are what
  validate it. The plugin then ends up unregistered and marked failed, as a contained boot failure does.
  What candidate-then-commit protects is `init` *throwing*, which is the failure a dev loop produces.

The client half is one event and no new machinery. The node broadcasts a content-free `plugins:changed`
frame; the shell re-reads the roster, re-resolves which bundle wins per plugin id — the one place the
once-per-session pin is deliberately dropped — and re-runs both contribution passes, which already
dispose-then-register. Trust is not bypassed: consent is keyed to a hash, so a plugin whose winning hash
moved to bytes this device has never accepted comes back untrusted, its code-bearing surfaces are
withheld, and the distribution pass queues the usual prompt. A plugin frame is an iframe whose ORIGIN is
its bundle hash, so a new hash is a new origin and a new document with nothing carried over.

**Boot** trust prompts are gone from development, because a development build acknowledges the bundled
first-party roster on exactly the terms a packaged build does — the same directory, read and hashed by
the helper (`packages/custody/src/plugins/bundledPluginTrust.ts`). This is parity, not a widening: a
hand-installed package, a third-party one, and anything a node serves this device still prompt. Set
`ACORN_PROMPT_BUNDLED_PLUGIN_TRUST=1` to get the prompts back when the trust flow itself is what you are
working on.

Mid-session rebuilds are not covered, and the reason is structural: the grant is made once, at helper
boot, over the bytes in the staging directory, and trust is keyed by `(pluginId, hash)`. Rebuild a client
bundle while the app is running and its new hash has never been granted, so the next registration pass
prompts — once, and not again after a relaunch. Rebuilding into the data root instead (a plain
`build:plugin`, or a package served by a paired `dev:node`) is outside the grant entirely and prompts per
rebuild by design; the marker that would let the host recognise a dev build cannot be a security signal
(`packages/node-core/src/server/plugins/bundled.ts` says why). So: iterate on a client bundle with
`--package-root` into `apps/desktop/dist/bundled-plugins` and relaunch, and a node-only change needs no
prompt at all.

Four first-party packages ship this way and none is also present in the compiled composition.
Rollbar was the first production caller of the route, descriptor and frame seams. `model-providers` is
one end of the range: node-only, no client bundle, no routes, no storage, `contributions: {}` — it
registers two connection providers and two model adapters and stops, which is proof the loaded tier
costs a small plugin nothing. Linear is the widest manifest here: a pane frame plus
a `refPanel` frame that ANOTHER plugin renders, a descriptor rail source with host-owned promotion,
declarative `contentLinks`, a command and a keybinding. HTTP is the other end from model-providers —
the only one that owns TABLES, so it is the only production caller of `ctx.storage` and of a
manifest-declared migration chain, and it also serves an `agentContexts` descriptor from its own
routes. Read it for the manifest half of the storage seam — the seam itself is shared with the compiled
tier now, so its whole node half is an `init` that opens storage and registers one route, with no
`dispose` at all. Read linear for the two surfaces rollbar does not
exercise, and read `docs/loaded-plugin-migration.md` for what all of these moves cost. The loader still supports a package id shadowing a built-in during
a staged migration; when that happens it drops the compiled copy from the graph and logs which
directory won.

## Approval-mediated install

The install route is device-gated, unmappable from a plugin frame, and audited, and none of that
changes. What exists on top of it is a way for an **agent's request** to reach the **owner's decision**.

The `plugin_request` agent tool (core-owned, `execute` tier — see
[agent-tools.md](./agent-tools.md)) takes an action (`install` / `update` / `uninstall`), a source or a
plugin id, an optional `dev` flag and one line of the agent's own reasoning. It installs nothing. It
cannot: `server/agentTools/pluginRequests.ts` imports `node:crypto`, `zod`, the tool registry and the
protocol types, and a test asserts that exact list, because the request/decision split is only a defence
for as long as that module has no installer within reach. The handler writes an in-memory row, broadcasts
a content-free `workflow:notice`, and throws `needs-trust` — a 409 to the agent, carrying a sentence
telling it to call again with the same arguments to collect the answer.

The owner sees the notice in the bell, which opens the approval dialog in the **shell's** overlay slot —
chrome a plugin frame cannot draw over. On approval **the device performs the install**, over the same
`/v2/core/plugins/*` routes Settings → Plugins uses, with its own principal. The agent never holds a
credential that can install code; a prompt-injected agent can produce a row in a queue and nothing else.

Four properties worth stating because they are easy to lose:

- **The queue rides the roster.** `GET /v2/core/plugins` carries `requests`, so there is no second route
  to remember to gate. `POST /v2/core/plugins/requests/:requestId` records the answer, is device-only by
  the same mount, and is permanently unmappable from a frame
  (`client-core/host/frames/scopes.ts`) — a frame that could post an approval would answer the very
  question that exists because an agent must not install.
- **One ask is one question.** Identical arguments resolve to the same pending row, and only the *first*
  raise rings the bell, so an agent cannot put a prompt on the owner's screen in a loop. Twenty
  outstanding requests is the cap.
- **An approval is spent once.** Collecting the decision deletes the row. A second identical call is a new
  question, not a second use of an old yes.
- **The store is in memory.** A pending request is a question waiting on someone looking at the app right
  now; a node restart is a perfectly good "no", and an hour is the expiry.

### What the owner can know before the download

The installer only validates a manifest *after* fetching and unpacking, so the first screen genuinely
cannot show one. The approval is therefore two screens, and the split is deliberate:

1. **The ask.** The action, the source string, the agent's stated reason, the dev flag. This is everything
   knowable before anything is fetched, and it is the gate on the fetch itself — a node reaching out to a
   URL an agent chose is a network action taken on an agent's say-so, so a No here means nothing is
   downloaded at all.
2. **The review.** The device installs, then reads the real manifest back off the roster and shows what
   the package declares. Install runs no plugin code — every result is `installed-restart-required` — so
   this still happens before anything executes, and its No uninstalls the package again (keeping its
   data, as every other uninstall path does by default).

The alternative — download and validate first, then approve against the real manifest — was rejected for
two reasons. It fetches on the agent's word with no human in between, and pinning the reviewed bytes
through to the install would need either a staging directory that outlives the request or a second
download that can resolve to something else. The second screen buys the same disclosure without either.

The client half of a plugin gets a third look regardless: the per-hash bundle trust prompt fires from the
next distribution pass, with the full permission diff. What screen 2 adds is the **node half**, which has
no other disclosure surface — it would otherwise start at the next restart with nobody having read what
it declared.

## Development mode

Per-hash trust is right for distribution and wrong for iteration: an agent saving a file every minute
would mean a prompt per save. So the owner makes one decision instead — approving a `dev: true` request —
and the device stores a **dev trust grant**.

The grant lives in the device's existing trust file (`packages/custody/src/plugins/pluginTrustStore.ts`),
beside the acknowledgements, as `{ pluginId, nodeId, path?, grantedAt }`. It is keyed on the **pair**.
The design note says "per (pluginId, device)" and the device half is the file itself; the node half is an
addition, because fleet resolution picks the highest version across every paired node and a grant keyed on
the name alone would auto-trust a bundle a *different* node started serving under it.

What it does: when the helper caches a bundle for a plugin under grant, it records an ordinary accepted
acknowledgement for those bytes right there — beside the hash it computed itself, in the process that
holds the grant. The renderer therefore never queues a prompt, and nothing about eligibility changes:
`bundleAccepted` and `eligiblePlugins().trusted` see an acceptance and behave exactly as they would for
one the owner clicked. A dev-written row is marked `dev: true` (so revocation can find it) and
`partial: true` (nobody read a disclosure, so it must never become the baseline of a later "what changed"
diff).

It hangs off the local-path install seam — `{ path }`, the absolute-path symlink — so the agent has an
in-place directory to iterate in, and a dev-mode install ends in a **reload** rather than a restart
prompt where the plugin is reloadable.

**Visibly different, and endable.** Settings → Plugins badges the row *in development — bundle changes are
auto-trusted* and puts an **End dev mode** button beside it. That is not decoration: the moment a dev-mode
plugin is indistinguishable from a normal install, the trust story has rotted. Ending it is one act with
two halves — the grant goes, and so does every acknowledgement the grant wrote. Without the second half
"revoke" would leave every auto-trusted hash still accepted. What survives is whatever the owner answered
by hand, so the plugin goes back to exactly where it was, and with nothing left the current bundle is
undecided again and the normal per-hash prompt asks about it on the next distribution pass. That is what
promoting a plugin out of dev mode means in practice, and revoking and promoting are the same operation.

**In a packaged build.** Dev mode widens nothing, and it no longer has to: the `{ path }` source it hangs
off is allowed on every build now ([security.md § Installing from a folder](./security.md)), so a packaged
app gets the same in-place directory a dev checkout does. The grant itself is source-agnostic and is not
gated on packaging — it is a device-side trust decision about a plugin the owner administers — so dev mode
over a remotely-sourced plugin still means only "future versions of this one do not re-prompt", and each
iteration there is still an explicit update because there is no directory to edit.

## Teaching the agent

The mechanics above do nothing on their own. An agent that has to guess at the manifest vocabulary spends
its first session finding out that `zod` will not resolve and that a second client module 404s, and the
loop is not worth entering. So the contract is served *by the node that enforces it*, through two doors
onto one text (`server/agentTools/pluginAuthoring.ts`).

The door the agent uses is the `plugin_authoring` tool — no arguments, `read` tier, and every list in its
answer derived at call time from the schema that enforces it rather than written down beside it
([agent-tools.md](./agent-tools.md) has the derivation table and the two omissions). The door a human uses
is the `plugin-authoring` **context section**, which is `defaultIncluded: false` and therefore free: a task
that is not writing a plugin never assembles it. That flag is why acorn can afford an authoring guide at
all, where bb pays for its 1,678-line equivalent on every session.

What the derivation cannot cover is process, so that half is prose: write the directory, ask with
`plugin_request { action: 'install', source: { path }, dev: true }`, expect `needs-trust`, call again with
identical arguments to collect the answer, then iterate with `action: 'update'` and the same `dev: true`
so the approval ends in a reload rather than a restart. The one limit that will otherwise baffle an
author is stated in those words: **only the entry module is re-evaluated**, so a multi-file node half needs
a restart for a change outside its entry file, and a plugin being iterated on hard wants to be one file.

The entry point is **Settings → Plugins → Create a plugin**, which drafts that starting prompt into the
current task's agent composer through the same `sendReferenceToAgent` seam the editor and changes panes
use. A draft, not a send: the owner reads it, says what the plugin should do and presses send themselves.
It deliberately does not open a *new* task — `TaskSeed` carries no prompt field and settings has no project
in scope, so that would be a protocol field and a column for the sake of an entry point, and the existing
seam is honest about the case where there is no agent session to draft into.

## The client half of a loaded plugin

A loaded plugin's UI is not registered by its own code. The Node hands each device the plugin's
manifest and the hash of its client bundle in the roster (`GET /v2/core/plugins`); the device
decides what to render from that, and the plugin's JavaScript never touches a shell registry.

Five kinds of contribution come out of that one manifest, and each has its own section below:
frames, remote trees, document surfaces, webviews, and descriptors. The wire format behind the
second one is in [The tree contract](#the-tree-contract).

## Frames

A pane, reference panel, settings page, project importer, or full-screen overlay picker that the
plugin draws itself. A `pane` declares a `scope` of `task` (the default, and what a pane has always meant: a
rectangle in a task's layout) or `project`, in which case it is drawn beside its own rail Source's
list at `/p/:projectId` with no task involved. A project-scoped pane must declare a `routes` entry
addressing it and a source whose `onSelect` navigates to it — those are its address and its only
mount site, and a manifest missing either is rejected rather than shipping a surface that can never
appear. Each renders in an iframe on `app-plugin://<bundle-hash>`, a scheme the shell serves
from its content-addressed cache with `connect-src 'none'`: the frame has no network, no
`window.acorn`, and no reach into the shell. Its only I/O is one `MessagePort`, where every call
is checked against the manifest's declared scopes by an allowlist naming each path and method
(`packages/client-core/src/host/frames/`, `scopes.ts` is the choke point). The host pins which
Node the frame talks to; the frame cannot name one. A `refPanel` frame is one of the two surfaces whose
surrounding chrome the host draws rather than the plugin (`overlay` is the other): an iframe cannot
`Portal` out of the box its consumer placed it in, and the bridge's close verb does not reach a
reference panel — it is granted to importers and overlays only — so the manifest adapter
supplies the drawer and its dismiss control while the frame supplies the body. It is also the one
surface no plugin *mounts*: the shell holds which ref is open and draws it in one place
(`client-core/host/registries/panes/refPanels.ts` + `refPanelHost.tsx`), so any surface that renders content can
call `openRefPanel({ providerId, displayId })` and get any provider's panel. One at a time, on
purpose — a stack of reference panels is a navigation history, which is what panes and routes are for
— and `openRefPanel` returns `false` rather than opening an empty overlay when that provider has no
panel installed on this device. A panel's props name its subject `target`, never `ref`: `ref` is a
reserved JSX attribute that Solid compiles into a DOM setter, so a props member of that name silently
arrives as a function instead of data. `tools/arch/boundaries.test.ts` holds the line, because
TypeScript cannot — Solid declares `ref` on `IntrinsicAttributes`.

A frame's boot is one call. `mountFrame({ styles }, (bridge, root) => …)` on `/ui/sdk` injects the
plugin's inlined stylesheet, makes the root element, mounts the frame-side tooltip listener (a frame
has its own document, so the shell's delegated singleton cannot see it and every `data-tip` inside
is otherwise inert), waits for the bridge, and paints an alert banner on the root if the handshake
never lands. It takes a render CALLBACK rather than a component so the entrypoint stays
framework-free: the four first-party frames happen to use Solid, the sandbox allows anything.

A frame has to say hello. The SDK posts one `connected` message the moment `connect()` resolves, and
the host starts a deadline when it transfers the port: a frame that never sends anything is replaced by
a labelled "This plugin’s UI failed to start" placeholder instead of staying a blank rectangle, which
is what a bundle throwing at module scope used to render. Any message counts as the acknowledgement, so
a bundle built before the ack existed clears the deadline as soon as it calls the bridge; a purely
static frame from such a bundle needs rebuilding. A surface the device could not register at all —
usually a contribution id something else already owns — is skipped so the rest of the plugin still
works, and reported in the attention inbox rather than only in the console.

**A loaded plugin's ids sit inside its own namespace.** Contribution ids are un-namespaced by design:
`pr`, `changes` and `terminal.drawer` double as persisted layout keys and chord targets, so they cannot
carry an arbitrary prefix. Plugin-versus-plugin collisions fail loudly, which is fine. The one that
did not was a collision with a *future core id*: core adds a pane called `notes`, an installed plugin
already registered one, and core loses a first-come race against a package the owner installed.
Nothing announced it.

So a loaded plugin's pane, source and slot ids have to equal its plugin id or start with `<id>-` or
`<id>.`, and one that does not is bound to `<pluginId>.<id>`. What counts as inside is the shape the
first-party packages already use — `database`, `http-requests`, `linear-issue` — which is why this
cost nothing to introduce: every id that has ever shipped already passes, so no saved layout moves and
there is no alias map. Commands were already qualified as `plugin.<pluginId>.<commandId>`.

The binding happens once, where the device reads the roster row
(`packages/client-core/src/host/plugins/contributionIds.ts`), rewriting the declaration and every reference
to it — `action.pane`, `action.surface`, `action.overlay`, `routes[].surface`, `contentLinks[].pane`.
Doing it at each registration site would be the same change made in eleven places and wrong in
whichever one got missed. Compiled plugins are untouched: they are the app, and an id they collide
with core on is a duplicate registration that fails in `pnpm test`.

The bridge's `api` surface is five verbs — `get`, `post`, `put`, `patch`, `del` — matching
`PluginBridgeApiRequest.method` exactly. That last part is the rule rather than a coincidence: a method
missing from the SDK facade is a method no plugin can reach, however permissive the scope table
underneath, and `put` was missing for exactly that reason until http (whose own updates take a
full-replacement body) could not call its own routes from its own frame. `frames/verbs.ts` is what
makes that class of bug a compile error now: it derives the wire union, the author-facing surface
(`sdk.ts`) and the host-facing surface (`PluginFrame.tsx`, through `FrameServices`) from one verb list,
with two `Covers<>` assertions that fail the build the moment a verb lands on the wire without a row on
either surface, or gains a surface row the wire does not carry.

### Binary bridge calls

Those five verbs stringify and parse everything. For a route whose body is bytes — an image, a PDF, an
archive — that costs a third more on the wire as base64, two copies in memory, and a decode at each
end, for content the host was already carrying as bytes. So there are two more:

```ts
const { bytes, type, filename } = await bridge.api.getBytes('/v2/p/image-markup/files/a1')
await bridge.api.postBytes('/v2/p/image-markup/files', { bytes, type: 'image/png', filename: 'a.png' })
```

A separate wire kind, `api.bytes`, rather than a flag on the JSON one, so a JSON call can never
acquire byte semantics by getting a field wrong. What the two share is the one thing that matters:
`allowApi` decides the path before either handler looks at a body. Your own `/v2/p/<id>/` namespace is
reachable and another plugin's is refused, byte call or not, and a 12 MiB POST at somebody else's
namespace is denied without being read. The desktop end-to-end suite pins that by spying at the broker.

GET and POST only, capped at 12 MiB either way: above the agents store's 10 MiB attachment limit, low
enough to be an explicit memory bound. No streaming — the desktop broker fully buffers a node response
already, so a chunked API here would be a shape with no transport under it.

`type` and `filename` are advisory in both directions. Whatever receives the bytes decides what they
really are; the agents attachment store, for one, re-sniffs magic bytes and re-normalizes the name.

Almost none of this was new transport. `infra/node/apiClient.ts` has carried a `Uint8Array` body from
the broker since it was written; the only reason a frame could not reach it was that `frameServices`
hard-coded JSON in both directions.

Two browser affordances a frame does NOT have, both worth knowing before writing one. `window.confirm`
and `alert` are suppressed: the iframe is sandboxed `allow-scripts allow-same-origin` and deliberately
not `allow-modals`, so `confirm()` returns false and a guarded action silently does nothing. And
`navigator.clipboard` refuses to write, because the frame's document is not the focused one from the
shell's point of view — `bridge.ui.copy` exists for that, and a confirmation is the frame's own UI to
draw (two clicks, an inline undo, whatever fits) rather than a host verb.

A link inside a frame's own rendered content reaches the shell through `bridge.ui.openUrl(url)`,
because the anchor itself cannot go anywhere: the iframe has no `allow-popups` and the shell pins every
subframe to its own origin. The frame passes a URL and learns nothing back. The host validates the
scheme at the boundary — `https` only, the same policy a manifest's `openUrl` descriptor verb is held
to (`@acorn/protocol/externalUrl.ts`), so `file:`, `javascript:`, `data:` and the frame's own
`app-plugin://` origin are all refused. A navigation must also be a person's act: the verb is honoured
only while the frame itself holds focus — which a real click or keypress inside its document gives it —
and at most once per second, so background code cannot move the reader and a hostile frame cannot spam
the browser. A frame using `openLinkOnClick` satisfies both for free. Then the host runs the same
content-link ladder every shell surface
runs: in-app when a recogniser claims the URL, the owner's browser otherwise. *Which* in-app
presentation is inferred from the calling surface, not asked of the frame: a link clicked inside a
reference panel swaps that panel's subject, and one inside a pane opens the pane. The SDK's
`openLinkOnClick(bridge, event)` is the delegated anchor handler on top of it, so a frame does not
hand-roll the plumbing; unlike the shell's equivalent it takes modified clicks too, because in a frame
there is no browser default for cmd-click to preserve.

## Remote trees

The second render path, and the one to reach for unless the surface genuinely owns
its pixels. The bundle runs in a Web Worker with no DOM and emits a *tree*: names of the host's own
components, with props, as a stream of mutations. The host mounts its components for those names, so
the result has the shell's focus handling, keyboard model, ARIA and the reader's style pack, none of
which an iframe can borrow. Every loaded plugin acorn ships draws this way.

Two ways to declare one, and they differ only in who owns the rectangle. A **region** of a surface
this plugin declares names `{ "kind": "remote", "entry": "<name>" }` in its `regions` — that is how
the panes, reference panels and settings pages of `http`, `database`, `linear` and `rollbar` draw. A
**contribution into somebody else's point** is a `contributions.extensions` entry with a `remote` key,
which declares which host surface it fills and what it matches. The agents pane opens three:
`agents:tool-card`, keyed by the tool name a harness reports; `agents:attachment`, keyed by an
attachment's media type; and `agents:composer-actions`, which stacks up to four contributors in the
composer's action bar.

An author writes the same code either way. `mountTree({ toolCard: … })` on `/ui/sdk` is the entry point
beside `mountFrame`, keyed by name because one worker serves every tree the bundle contributes and the
host has to say which. With a bundler, `@acorn/plugin-api/ui/tree` (published as
`acorn-plugin-sdk/remote`) carries the Solid adapter and the kit as nodes you write in JSX; without
one, `npm create acorn-plugin <name> -- --remote` emits a single file that builds the same tree by
hand.

What crosses is data, all the way down. A handler is an id the host mints a closure for, never a
function; text is a node, never a prop; `class`, `style` and every other door into the host's DOM are
dropped with a row on the plugin's page; a node name this build does not know draws a labelled
placeholder, which is the forward-compatibility rule above applied to drawing. A batch applies whole or
not at all, and a worker that stops answering is terminated with a placeholder in every tree it served.
The wire is `@acorn/protocol/tree/`, the host is `client-core/src/host/tree/`, and
`docs/shell.md § The plugin worker` has the sandbox.

Two things a tree is not for. Anything that must react per keystroke — a live filter over a large list,
a query editor with completions — is a message hop per key and should be a frame. And a surface whose
pixels are the product, an image editor or a charting library, is a frame by definition.

## Document surfaces

A pane whose editor the **host** draws, with the plugin supplying only the
document. A `pane` surface names a `layout` and fills its `regions`, and a region is a host-drawn
document, a remote tree, or `"frame"`, the plugin's own bundle in an iframe. `docs/panes.md` § Layout
model lists every layout and its regions; the two that matter here are `single`, where the whole pane is one
text document, and `document-over-frame`, where that document sits above the plugin's own region
with a host-owned drag handle between them. That lower region is a tree in every shipped case; the
region keeps the name its layout gave it.

```json
{
  "contributions": {
    "frames": [{
      "target": "pane", "id": "scratch", "label": "Scratch", "glyph": "file-text",
      "layout": "single",
      "regions": {
        "body": {
          "kind": "document",
          "languageId": "sql",
          "read": "/v2/p/board/tasks/:taskId/scratch",
          "write": "/v2/p/board/tasks/:taskId/scratch"
        }
      }
    }]
  }
}
```

That is the entire job: `read` answers `GET → { text }`, `write` receives `PUT { text }`, and the
host does the rest — the editor instance, its theme, its workers, the dirty model, the autosave
debounce, ⌘S, the flush before unmount, and the scroll/cursor position across remounts (keyed by
node, scope and document, and evicted when a task or workspace is). Omitting `write` is a real mode
rather than a degenerate one: the surface is read-only, which is what a rendered template or a
generated migration wants. `languageId` comes from a published vocabulary
(`@acorn/protocol/languageIds.ts`, LSP's spellings) so an unknown one is a parse error rather than a
document that silently renders as plain text; the host maps it onto whichever engine draws it. Only
`:taskId` and `:projectId` are substituted into a route — those are the two values the host holds —
and both routes are confined to the plugin's own namespace at parse time and again on the device.

**This exists because the sandbox provably cannot serve it.** A Monaco frame measures 7.93 MiB
against the 8.00 MiB client-bundle cap with a stub UI, and its language-service workers cannot be
delivered at all: a plugin origin serves one file and the frame CSP has no `worker-src`. The
alternative — multi-file plugin origins plus `worker-src` — would be a standing grant to every
installed plugin, forever, to serve two first-party panes. A host-owned surface widens nothing, and
costs no plugin a duplicated 7.9 MiB. The bar for any future host-drawn region is that one:
**common is not the bar; impossible is.** Master/detail is common — every frame already draws its
own with ordinary CSS — and the host rendering a plugin's list *from data* would mean designing and
eternally versioning a widget toolkit in the wire format. The answer to that stays no.

`collections` (§ Descriptors) walks close enough to that line to be worth distinguishing on the
record, because it did not reverse it. What was refused is reproducing *a plugin's bespoke UI* from
data — an unbounded fidelity chase, where every plugin's layout is a new thing the wire format has
to be able to say. A collection feeds the host's **own** generic surface, where uniformity across
providers is the entire point: two plugins' rows can only share one board if neither of them draws
anything, and a frame cannot participate in a board at all. What crosses the wire is a record
schema — seven field types, five roles, closed and versioned — not a widget toolkit, and the host
renders its own views over it. The guardrail is that budget: when the vocabulary cannot express
something, the answer is still a frame pane. The full argument is
[dashboards.md](./dashboards.md); the refusals it keeps are in `docs/future/dashboards/refused.md`.

Because a pane with no `frame` region runs no plugin code on the device, it is gated like a **descriptor**
rather than like a frame: no bytes execute, so there is nothing for a bytes-hash trust prompt to be
about, and a plugin that ships only document surfaces needs no client bundle at all. The ceiling is
the honest one — a declarative contract gives a plugin the editor's *features*, not its *API*. No
decorations, no inline widgets, no arbitrary providers. Capabilities grow only as LSP-shaped
request/response routes (completions first, when a consumer needs them), never as "run my code
inside the editor".

`layout` is region-addressed rather than whole-pane-addressed, and that was decided before there were
layouts to address: a whole-pane declaration would have meant something different once a second
arrangement arrived, and changing that later would change what already-published manifests mean.
`frame-beside-document` exists and lands with its consumer, the editor plugin. The design record is
`docs/editor.md`, and `docs/panes.md § Layout model` owns the layout set.

### `document-over-frame`

```
┌──────────────────────────────────┐
│ host document surface (sql)      │  host: the editor, theme, workers, dirty state, ⌘S, view state
├──────────────────────────────────┤  host: the drag handle
│ [picker] [Save] [Generate] [Run] │  the plugin's frame starts here
│ results grid                     │
└──────────────────────────────────┘
```

The host composes this, and the plugin could not: the frame CSP has `frame-src 'none'`, so a plugin
can never embed host content inside its own layout. That restriction binds the plugin and not the
host, which is the whole shape of the design — the host places its editor and the plugin's iframe as
siblings in its own DOM.

A composed pane runs plugin code in half its rectangle, so unlike a wholly host-drawn one it needs an
accepted bytes hash and a client bundle exactly like any other frame. It is not a cheaper way to run
untrusted code.

What is deliberately *not* a region: the button bar. `plugins/database`'s bar holds a searchable
saved-query picker with per-row delete chips, a Generate button visible only when a model connection
exists, and an Execute button disabled on connection status. A host-drawn "action bar" descriptor
sounds cheap until it needs all three. The bar is common, not impossible, so it is the plugin's — the
first row of its own frame region. Modals are the one honest compromise: a frame confined to the
bottom region can only overlay the bottom region, and the escape hatch if that grates is the
`overlay` frame target rather than a widened template.

**Two regions, no shared realm.** The editor is in the shell and the frame is a sandboxed iframe, so
everything between them goes through the host, in two directions:

- **Frame → host: `bridge.document`.** `read()` is the current text including keystrokes the autosave
  has not written yet; `write(text)` goes through the model, so it joins the undo stack and schedules
  the same autosave typing would; `flush()` writes anything pending to the plugin's own write route.
  Three methods, each with a proven consumer. There is deliberately nothing about the EDITOR — no
  cursor, no selection, no decorations — because those are host state or LSP-shaped routes. The verb
  is gated structurally rather than by a declared scope: a frame either has a document beside it or it
  does not, and which one is a fact about the manifest the host already read.
- **Host → frame: surface actions.** A chord like `⌘Enter` is pressed with focus inside the host's
  editor, where the frame has no keyboard at all. A `commands` entry declares
  `{ "verb": "surfaceAction", "surface": "<pane id>" }` and a `keybindings` entry with
  `when: "surface"` binds the chord. The host resolves it, **flushes the document**, then posts the
  command id over the frame's bridge, where `acorn.onSurfaceAction` receives it. The flush is a
  contract guarantee, not an implementation detail: without it every plugin independently rediscovers
  "it ran the previous version of my query". A frame handles the command exactly as it would its own
  button click, and is not told which gesture produced it.

### Language smarts

A document region may declare `completions: { route, triggerCharacters }`. The host POSTs
`{ text, position }` (1-based line and column) and renders the `{ label, kind, insertText, detail }`
items that come back. **The host never learns the language**: context detection is the plugin's, on
its node half, where the schema knowledge already lives — which is exactly what lets a SQL console, a
GraphQL console and a YAML config plugin share one host provider with no host change.

The growth rule this sets as precedent: **capabilities grow as LSP-shaped request/response routes —
position and text in, standard items out — never as "run my code inside the editor".** Hover and
diagnostics can follow the same shape when a real consumer needs them. Custom widgets, decorations
and inline UI cannot, and the test for any proposed addition is "is this an LSP method". The wire
shapes are `@acorn/protocol/documentSurface.ts`; the kinds are LSP's names rather than its magic
numbers, because this wire is read by plugin authors and not by an LSP client.

## Webviews

A host-drawn pane backed by a shell-owned child webview. A surface declares exactly one literal `url`
or plugin-owned `urlSource` plus a non-empty `hosts` allowlist. HTTPS is required except for
`localhost`, `127.0.0.1`, and `::1`; the renderer broker validates requested navigation and the shell
enforces the same list on direct navigation and redirects. The page has an
isolated ephemeral partition, no preload, no CDP, no devtools, no tunnel credentials, and no script
or message bridge. The plugin's sandboxed client frame remains the controller for only
`navigate`, `back`, `forward`, and `reload`; it cannot read the page or type into it.

## Descriptors

A rail source, a badge in the task footer or the topbar, commands and keybindings, attention items,
node stats, context-menu rows (`contextMenus`), restricted URL recognizers (`contentLinks`), renderer
routes (`routes`), agent-context entries (`agentContexts`), batch reference resolvers
(`refResolvers`), typed record sets (`collections`), periodic node-side work (`schedules`), and colour
themes (`themes`). These are data, not code: the host renders them with its own components and fetches their content
from routes in the plugin's own `/v2/p/<id>/` namespace, so they stay live when no frame is
mounted anywhere (`packages/client-core/src/host/chrome/`). Freshness rides the existing
invalidation ping plus one shared timer. A plugin that ships only descriptors needs no client
bundle at all, and therefore no trust prompt — nothing of its executes on the device. A source may
declare `createTask`; its row supplies the task seed and optional external link, while the host owns
the modal, origin namespace, connection ownership check, create-before-link ordering, and
partial-failure reporting. A source may declare `projectScoped`, which says its items route reads
the shell's project: the host then appends `?project=` to that route, keys the cache by it, and
offers the topbar project picker while the source is on screen. It is opt in, so a manifest written
before the field and a plugin that never thought about projects both get one shared list instead of
an identical one refetched per project (docs/frontend.md § the router is registry-driven). A source may also declare an `emptyState` — one bounded message and at most
one context-free action — shown when its route answered with *no items*, in place of the host's fixed
"Nothing here yet.". Not when the fetch failed: an unreachable node already has its own banner, and
telling someone "nothing is assigned to you" because a request timed out is a claim the host has no
business making on a plugin's behalf. It is deliberately no richer than a sentence and a button; the
field exists because a rail that cannot say what empty *means* pushes sources into showing a wrong
list instead of an empty one, which is exactly what Linear did. `emptyState` belongs to this
descriptor twin only (`@acorn/protocol/api.ts` § `PluginSourceEmptyState`): a first-party
`SourceContribution` is a component and already renders whatever it wants when it has nothing, so
the same field there would be one every first-party source carries and none reads. A `contentLinks` entry uses a
bounded `https://` host/path grammar and delivers one captured path segment to one of **three**
destinations: an optional **task-scoped** `openPane` from the same manifest, which receives it as a
`plugin:select` intent in the active task; the plugin's own **reference panel**, shown over
whatever the reader was looking at; or the plugin's own **route**, which takes the reader there —
declared as a `path` resolver on a compiled recogniser, since only the owning plugin can turn a URL
into one of its addresses (`plugins/github/src/client/contentLinks.ts` resolves owner/name to a
project). Taking a route also selects the rail source that owns it, because the shell renders from
the rail rather than from the location. A link must have at least one of the two, or the manifest is
rejected — a recogniser that matches URLs and can never open anything looks installed and is not.
Which destination a click gets is the *clicking surface's* call and not the manifest's, because it
depends on where the link was: a pull-request conversation asks for the panel so the reader keeps
their place, a note takes the pane, a dashboard row asks to be taken to the route. Each is a
*preference*, and the host falls through the remaining two in a fixed order when the asked-for one is
unavailable, so no surface has to know which destinations a given provider actually installed. The panel is never *named* — it is addressed by provider, the host stamps
the plugin id onto every recogniser it registers, and a `refPanel`'s provider must already be the
plugin itself, so a manifest cannot point a link at another plugin's panel. Likewise a target naming
anything that is not a registered task pane resolves to nothing rather than pushing an unrenderable
pane id into a task's persisted layout. A `routes` entry gives a project-scoped surface a URL. Its
A source may also declare **`tracksRef`** — "does this task already track this external item?" — which
is `taskPath` read backwards and exists for the same reason. `task.links` is not the only way a task can
be attached to an external item: a github-pr task records its pull request as `pullNumber` on the task
row, and its links hold the *Linear* tickets found in the PR body. The host asks links first, since that
is provider-agnostic and covers everything that seeds them, then asks every source for its own second
spelling. A source that has only one way of recording the relationship implements nothing.

A source may also declare **`defaultPane`**, the pane a task it tracks opens on the first time it is
activated. Like a content link's `openPane`, it is re-checked on the device against the panes this
manifest declares, so a roster row cannot aim core's first-open at somebody else's pane.

`path` is confined at parse time to the prefix the host mints from the plugin id —
`/p/:projectId/x/<plugin-id>/` — so it cannot claim core's `/p/:projectId`, `/p/:projectId/new`, or
another plugin's path, and a collision is a manifest error rather than a race between two loads. It
names a project-scoped `surface` from the same manifest and one `item` parameter of its own path;
the host does the matching and supplies the value. A source's `onSelect: { "verb": "navigate",
"surface": … }` is what changes that URL from a clicked row — the URL is where a project-scoped
surface's selection lives, because unlike a task pane it has no layout state to keep one in. A
command may not carry `navigate`, for the same reason it may not carry `createTask`: a command
registry row has neither a routed project nor the shell's navigator in scope. A slot badge's
`onClick` takes the same narrowed verb set as a command — `openPane`, `runNodeAction`, `openUrl` —
for the same reason: its click carries no selected row and no routed project, so a verb that needs
either would parse and then only ever fail. Only a source's `onSelect` gets the full set, because a
rail row is the one click site with a row, a project, and the promotion callback in scope.
`surfaceAction` is the one verb whose effect lands *inside* a plugin rather than on the shell: it
delivers the command's own id to a region of one of that plugin's own panes, and it may only name a
pane the same manifest declares that draws such a region — an iframe or a worker tree qualifies alike,
and a pane whose regions are all host-drawn does not, because there would be nothing on the far end of
the bridge to receive it. A document beside the region is not required. The verb was born in a
`document-over-frame` pane, where `⌘Enter` is pressed in the host's editor and the frame has no
keyboard (§ Document surfaces above), but the palette is the other way in, and from there "do this in
the thing I am looking at" is a sentence about any pane the plugin draws — http's `list-detail`
request panel as much as database's editor-over-panel. It is useful only on a
command, because what it delivers *is* the command id, and a footer badge has no command in scope. An `agentContexts`
entry names two routes — `options`
(GET) and `capture` (POST) — and puts a row in the agent composer's context picker. Its `capture`
answer is the one descriptor response that ends up inside a model's prompt, so it is parsed against
a schema rather than sniffed field by field, and the host binds what a plugin must not: `source`
comes from the plugin id, the capture time is stamped here, and the bytes are measured from the
content received rather than believed from the response, so the shared 512 KiB
`MAX_AGENT_CONTEXT_BYTES` ceiling cannot be talked past. An over-budget capture is refused whole,
never trimmed. The `revision?()` half of the first-party contract has no manifest form on purpose:
it is synchronous, a descriptor answers across a fetch, and the invalidation ping already covers
freshness. The whole entry is two routes and a label:

```json
{
  "contributions": {
    "agentContexts": [{
      "id": "http-requests",
      "label": "HTTP requests",
      "description": "Saved requests and their latest responses",
      "options": "/v2/p/http/agent-context/options",
      "capture": "/v2/p/http/agent-context/capture"
    }]
  }
}
```

`options` answers `GET → [{ id, label, description?, defaultSelected? }]` for the picker; `capture`
receives `POST { taskId, workspaceId?, optionIds? }` and answers
`[{ contextId, label, content, resourceId?, provenance?, deepLink?, freshness?, sensitivity? }]`
(`@acorn/protocol/agentContext.ts` is the schema). Everything else on a snapshot — `source`,
`capturedAt`, `byteSize`, `estimatedTokens` — is measured and stamped by the host, never read from
the response.

A `refResolvers` entry is the same carrier shape for a different question: **what another plugin's
surface should draw** when it is holding identifiers of this plugin's items. Recognition already has
an answer — `contentLinks` declares the URL shapes, and the host scans any text for every registered
recogniser at once (`scanContentRefs`) — so this is only the enrichment half, and it exists because
the alternative was a cross-plugin import (`github` importing `@acorn/plugin-linear/contract`) that
cannot survive either side becoming a loaded package.

```json
{
  "contributions": {
    "refResolvers": [{
      "id": "linear-refs",
      "kind": "linear.issue",
      "resolve": "/v2/p/linear/issues"
    }]
  }
}
```

The host POSTs `{ identifiers }`, count-capped, and parses the answer as
`[{ identifier, label, state?: { name, color, kind }, url? }]`
(`@acorn/protocol/refResolvers.ts`). `providerId` is **not** in the body — the host stamps it from
the plugin whose route answered, the same rule that stops a recogniser claiming another provider,
because a row that could name its own provider could publish a stranger's items behind a stranger's
reference panel. A consumer addresses a resolver by provider and never by route
(`refResolutionsOptions` in `client-core/host/registries/panes/refResolvers.ts` owns the query key and a
five-minute staleness for every provider alike), so a surface enriches Linear and a tracker nobody
has written yet with the same call.

The response vocabulary is deliberately a label and a state chip, and should stay that way. Every
field added here is a field *every* provider's answer gets rendered with, which is the descriptor-tier
slope this tier has declined more than once. The route spends provider credentials on a cache miss,
and is already behind `requireProviderAccess` through the provider mount — that gate is the
authorisation, the identifier cap is the budget, and neither replaces the other.

A `collections` entry is the descriptor tier grown one size: from a node stat's one integer with a
label to a **typed set of records**. The plugin declares what a route answers with — fields with a
semantic `type`, an optional `role`, and their display hints — and the host draws the rows with its
own components. It is the same argument the rest of this tier makes, at the point where it stops
being obvious, so the boundary is worth stating: this does **not** reverse the master/detail refusal
below. What was refused is reproducing a plugin's *bespoke* UI from data, an unbounded fidelity
chase; a collection feeds the host's *own* generic surface, where uniformity across providers is the
entire point — two plugins' rows can only share one board if neither of them draws anything.

```json
{
  "contributions": {
    "collections": [{
      "id": "issues-mine",
      "name": "My Linear issues",
      "items": "/v2/p/linear/collections/issues-mine",
      "refresh": 600
    }]
  }
}
```

The route answers `{ schema: { fields }, rows: [{ id, values, action? }] }`, parsed against
`@acorn/protocol/collections.ts`. `(pluginId, collectionId)` is the universal reference and nothing
else addresses a collection. Four rules carry the whole design:

- **The field vocabulary is closed and budgeted**: seven types (`text`, `number`, `boolean`,
  `datetime`, `enum`, `person`, `link`) and five roles (`title`, `status`, `assignee`, `url`,
  `updated`). Semantic rather than primitive, because the type is what lets the host render a person
  as an avatar and *derive* which views a collection supports — only an `enum` can become kanban
  columns. Every type added is a rendering rule every provider inherits forever; when the vocabulary
  cannot express something, the answer is a frame pane, not a wider wire format.
- **Display hints live on the field, never on a panel** — a `number`'s unit, an `enum`'s declared
  values with their labels and tones — so they survive a view switch and a cross-source mapping.
- **Row identity is required and provenance is host-stamped.** `id` must be stable across refreshes;
  `pluginId` and `collectionId` are not in the body at all, and the host binds both from the
  contribution whose route answered — the same rule as `refResolvers`' `providerId`, for the same
  reason. A mixed board routes clicks on that stamp.
- **A row action takes the context-free verb set only.** A panel row has no rail row to promote and
  no routed project to substitute, so `createTask` and `navigate` are not in the union. `openTask` is
  in it, and is the one verb that needs nothing but the row's own `taskId`: go to that task and stop,
  for a row whose thing *is* a task. From a click site with no row, a command or a slot badge, it has
  nothing to aim at and the host refuses it out loud rather than doing nothing. An action
  may declare an optional `risk` tier — `read` | `write` | `execute`, the same vocabulary an agent
  tool uses — and anything above `read` is armed: the *host* draws the confirmation from the tier
  and dispatches nothing until it is accepted. Never a new verb, and never plugin-drawn
  confirmation UI, because a plugin that could draw its own dialog could draw a reassuring one over
  a destructive call.

A collection may also declare `params`: up to eight named inputs, each `text` or `enum`. The host
renders one control per param in the panel editor and appends the values to the route as query
parameters; it never interprets them. The plugin owns what `repo` means, and the day it means
something else the host does not change.

The manifest `schema` is optional, because the response carries its own. The declared one is the
*static* case — a promise about the route, so an editor can offer views before any data exists — and
a collection whose columns cannot be known at build time simply omits it. Linear does: only a Linear
workflow state's `type` means the same thing in every workspace, so its rows group by the type and
the response labels each group with the workspace's own name for it. A malformed page is dropped
whole and logged, never half-parsed: a table missing some of its rows reads as complete and is not.
The cost of omitting the schema is real and worth knowing before you do: nothing can be configured
over that collection until it has been fetched once.

Everything the host does with the answer — panels, the views it derives, the cross-source mapping
layer, per-panel refresh, and where compositions are persisted — is
[dashboards.md](./dashboards.md). A plugin needs none of it to provide a collection.

A `schedules` entry is the one descriptor that acts **when nobody is watching**. It names a route in
the plugin's own namespace, a cadence from the vocabulary in [schedules.md](./schedules.md), and an
optional timeout in seconds; the node's one scheduler POSTs `{ scheduleId }` to that route on that
cadence with no client open, and ignores the answer beyond ok/error — a schedule is not a data
channel. At most four, because a package with more than a handful of distinct periodic jobs is
describing a daemon and the daemon here is the node.

```json
{
  "contributions": {
    "schedules": [{
      "id": "refresh-mirror",
      "name": "Refresh issue mirror",
      "run": "/v2/p/linear/schedules/refresh-mirror",
      "cadence": { "every": 600 },
      "timeout": 120
    }]
  }
}
```

A manifest declaring one must declare a `node` half — only a node half serves that namespace, so a
client-only package's schedule would fire forever against a 404, and that is a parse error rather
than a run row that fails every hour. The cadence floor for a plugin is 300 seconds and is enforced
on read from the registry key, not restated in the manifest: below that a schedule is a poll, and
polling is a client's job for a person who is present.

It joins the trust dialog's **Declared** group — "Run *Refresh issue mirror* on the node every 10
minutes, with nobody watching" — and is recorded with the decision, so a version that moves from
daily to every five minutes reads as newly requested. Disclosure, not new capability: the run route
is one the plugin already owns and could already reach from any of its surfaces. What changes is
*when*, and that is exactly what the line says.

A compiled plugin has no manifest to declare from, so it registers node-side instead, in `init`:
`ctx.schedules.register({ scheduleId, name, cadence, timeout?, run })`, where `run` takes the run's
`AbortSignal`. Both feeders land on the same registry under the same `<pluginId>:<scheduleId>` key,
and the host owns removal — declaring the schedule *is* the lifecycle, so a `setInterval` in plugin
node code is a review flag. The lifecycle table (what survives a disable, an uninstall, a manifest
that drops an id) is in [schedules.md](./schedules.md).

One trap worth naming: a manifest-declared schedule on a dev-installed package needs the package
**rebuilt** before the node sees it. Reconciliation will not do it, and the symptom is a plugin that
reloads fine and schedules nothing.

Two smaller node-side registries follow the same two-feeders shape, and both exist so that something
can happen while nobody is watching (`docs/schedules.md`):

- **`ctx.collections.register({ collectionId, items })`** — where this plugin's collection can be
  read *from the node*. Not a second way to declare a collection: the client-side registration is
  still what puts one in a panel editor, and this is the pointer the measure sampler dispatches
  through. A loaded plugin registers nothing here; the host synthesises its entries from the
  manifest's `collections` descriptors, which already carry `items`.
`ctx.collections` is owner-bound by the host and cleared with everything else a plugin registered,
and it re-checks route confinement on every call rather than only at registration.

**Node actions have no `ctx` member.** Which of this plugin's actions a person may put on a schedule
is declared in the manifest, as a **command** whose verb is `runNodeAction`, and the host replays
that through a host-only seam (`HostPluginContext` in `server/pluginHost/types.ts`). Declaring nothing
means none of this plugin's actions can be scheduled, which is the right default for most of them;
an action that declares no `risk` is treated as `execute`, so the omission fails safe rather than
quiet. It sat on `NodePluginContext` until 2026-08-27, where it read as something an author writes,
and across 21 plugins nobody ever did.

A `themes` entry is the descriptor tier taken to its limit: a **colour** theme with no route, no
bundle and no CSS, declared as a map of the 22 palette tokens plus a `dark` flag. The host validates
the map and generates the `:root[data-theme="plugin:<id>:<theme>"]` block itself, so nothing a plugin
wrote is ever parsed as a stylesheet — which is why this seam needed no new trust boundary. A theme
cannot express shape, density or layout, cannot restate a derived token, and cannot set the three
self-description tokens (the host writes those from `dark`). Both ends validate: the node at parse
time so an author sees the error at install, the client again before generating CSS because a roster
row is bytes a node sent. The token contract, the value grammar and what happens to a stored
preference when the owning plugin disappears are in `docs/ui-design.md § Plugin themes`.

```json
{
  "contributions": {
    "themes": [{
      "id": "nightfall",
      "label": "Nightfall",
      "dark": true,
      "tokens": { "--bg": "#12121a", "--text": "#dcd7ff", "…": "…" }
    }]
  }
}
```

## The tree contract

What actually crosses the port, for anyone reading `packages/protocol/src/tree/` or writing a second
host. It is the tree half of the same story `frames/verbs.ts` tells for the bridge: one list both ends
compile against, and neither end may reach for the other's copy. Nothing in it names the DOM, which is
what lets a terminal renderer apply the same mutations to a cell buffer.

**A second host exists and does exactly that.** `acorn`, the terminal client
([tui.md](./tui.md)), applies these five mutations to cells (`apps/tui/src/plugins/TreeHost.tsx`). The rules are not written twice: the store,
the whole-batch pre-flight check, the prop sanitiser and the one place a handler id becomes a closure
are `packages/client-core/src/host/tree/treeState.ts`, which both hosts import, and each host owns only
its shell — a table of components per node name, a placeholder, and when a batch flushes. What differs
in the sandbox behind it is the realm and nothing else: a Web Worker under a CSP on the desktop, a
`node:worker_threads` thread under `--permission` in a terminal, the same two ports and the same
handshake either way (`docs/security.md § Rung 0 — The client sandbox`).

**A host's table maps a name to a component or to a loader.** A tree names types, so each host keeps a
table from a kit node name to the thing that draws it
(`packages/client-core/src/host/tree/components.ts`, `apps/tui/src/kit/components.tsx`). Cheap
primitives are the component; the heavy names — the diff viewer, the diff rows, `Markdown`, `Timeline`,
`ModelConnectionPicker` — are a loader, because a table that holds every value puts every value in the
chunk that holds the table, and the DOM host's table is fetched on every cold window whether or not a
loaded plugin exists (`packages/client-core/src/host/tree/kitEntry.ts` says which and why). Each root
is drawn under a `Suspense` with a `null` fallback, so **a tree that names a heavy node draws nothing
for one frame and then draws it**. Nothing else changes: the mutations, the caps and the events below
are the same either way, and a plugin cannot tell which entry answered.

**A node is `{ id, type, props, children }`.** `type` is a kit node name. `id` is minted by the
sandbox adapter and is stable for the node's life; it is what events and patches address. `props` is a
plain object. Text is its own node (`#text`), never an attribute, so the wire has one node shape
rather than two.

**Five mutation kinds, in a coalesced batch** — per animation frame on the desktop, per timer turn in
a terminal, which is the host's decision rather than the protocol's: `insert(parent, index, node)`, `remove(id)`,
`patch(id, props)`, `move(id, parent, index)`, `text(id, value)`. `parent: null` addresses the slot's
root. A batch applies atomically or is dropped whole with a row on the plugin's page — half a batch is
a tree the sandbox never described.

The check that decides is a simulation: the host projects the batch against a copy of the parent map
and a child index built once, so an op is judged against the tree the ops before it in the same batch
would have left. A `remove` takes its whole subtree out of that projection by walking down the index,
which means a batch costs its own ops rather than the tree it is applied to — emptying a tree at the
5,000-node cap is 71 ms rather than the 1.1 seconds the earlier scan-every-node walk took
([performance.md](./performance.md) § The tree host's remove).

**Eleven events, host to sandbox**: `onPress`, `onChange` (the committed value), `onSubmit`,
`onSelect`, `onActivate`, `onToggle`, `onOpenChange`, `onExpand`, `onDismiss`, `onPick`, `onRemove`.
Never a key and never a pointer event, because a terminal host has neither and has to be able to map
its own keys onto these eleven names. A prop whose name is in the list carries a handler id; a prop
whose name starts with `on` and is not in the list is dropped.

**Lifecycle** is `tree:mount(slot, entry, props)` and `tree:unmount(slot)` from host to sandbox, with
`tree:ready`, `tree:batch` and `tree:failed` coming back, plus a ping. One worker serves many trees —
a tool card per call, a section per tray — so every message names its slot. A second `tree:mount` for
a slot already mounted is a props update, which keeps a tool card's redraw one message rather than a
teardown.

**One message expects an answer**: `tree:host-request(slot, id, op, name, payload)`, replied to with
`tree:host-reply(slot, id, ok, body | error)`. Two operations and no more — `owner.invoke` calls an
action the point's owner declared, `overlay.open` presents this contribution's companion overlay — and
neither is a dispatcher; [Asking the owner](#asking-the-owner) has what each one grants. `id` is the
sandbox's own sequence and the host only quotes it back, exactly as the bridge's request ids work one
rung up. A payload or a reply body over 64 KiB is refused, eight may be outstanding per slot, and an
owner has ten seconds to answer. The failure arm is a code and a sentence, never a host stack.

The whole reason it rides here rather than the bridge is the slot. One worker holds one bridge, so a
request that crossed the bridge could not say which of a bundle's mounted trees sent it; a request that
crosses this channel is addressed by the port and the slot the host already trusts, and plugin code
supplies no identifier at all.

**Every message is validated**, because the host is the only thing between a stranger's code and the
shell's DOM:

- `type` has to be a node this build knows and can draw on this host. Anything else renders the
  labelled placeholder and records a roster row — the forward-compatibility rule applied to nodes.
- A prop value is a handler id or plain JSON, depth-bounded. `class`, `className`, `style` and
  `classList` are refused outright, a role prop carrying a raw colour is refused, and a function can
  never cross because a function is not JSON. A failing prop is dropped, the node still renders, and
  the row says which prop.
- Text is set as text. `Markdown` goes through the shell's own markdown policy. A `Button` carries a
  handler id, never a URL or a command id; navigation is `bridge.ui.openUrl`, held to the same rules
  as a frame's.
- **Caps**, in `TREE_LIMITS`: 1 MiB and 4,000 mutations per batch, 5,000 live nodes and 64 levels of
  depth per tree, 65,536 characters in one text node, 512 trees per worker. The byte cap is sized like
  the state channel's 1 MiB per value: generous for anything honest, small enough that a bundle cannot
  use the renderer as a memory bomb. Past a cap the batch is dropped and recorded.
- **Rate**: batches are coalesced per frame on the host side. A sandbox that floods is throttled, not
  trusted.

The version travels in the handshake (`TREE_PROTOCOL_VERSION`), and a mismatch is a placeholder rather
than a crash. `packages/protocol/src/tree/nodes.ts` carries the node names, the eleven events and the
role enums as plain constants with no Zod on them, because that file is bundled into a stranger's
plugin; `messages.ts` holds the schemas the host parses with. The lists are duplicated from
client-core's kit, which owns them, and a test over there fails the moment the two disagree.

The sandbox itself — one Web Worker per bundle, what it has and what it does not, and what happens
when it throws — is `docs/shell.md § The plugin worker`.

## One shared eligibility and trust check

Both registration passes (frames and chrome) need the same answer to "who may contribute, and what did
they declare": identity and trust. That answer used to be written out twice, in `frames/register.ts`
and `chrome/register.ts`, including a byte-identical task-pane predicate that feeds the `openPane`
allowlist, the list deciding which pane ids a sandboxed frame may ask the host to open. A security
check maintained in two copies, connected by nothing, fails silently in whichever direction an author
updates only one of them, and `tsc` stays quiet because each copy is locally consistent on its own.
`packages/client-core/src/host/plugins/contributions.ts` now owns that shared half; the passes keep their
own job, rendering a sandboxed iframe versus registering a command.

`eligiblePlugins()` returns one row per plugin id, and each row's `hash` and `trusted` come from the
same place: the bundle that **won fleet resolution**, not the first one a roster happened to list. In a
mixed-version fleet, node A might offer v1 while node B's v2 wins; taking the manifest from one row and
the hash from another would register contributions declared by bytes nobody accepted. A package with no
client half anywhere in the fleet never enters resolution, so it falls back to the first row seen; such
a package contributes only descriptors and host-drawn surfaces, whose behaviour does not depend on which
node described them. `trusted` is true only when the device has accepted the exact bytes that won
resolution, never the row's own claimed hash: a candidate dropped at resolution can still carry a
`client.hash` in its roster row, and honoring that would let an acceptance recorded against an older,
runnable build clear a bundle this device has already decided not to run.

Frames and chrome ask different-strength questions of the same row. Frames gate code-bearing surfaces
on `trusted` outright. Chrome asks the weaker `hasWithheldCode`: does this package carry code the device
has not been cleared to run? A descriptor-only package has no such code, so withholding its rail rows
and commands would hide a plugin that executes nothing.

`declaredSurfaces()` classifies a manifest's frames into three disjoint sets, kept apart because folding
them together would let `openPane` accept an id it must not: `panes` (task-scoped, the only surfaces a
task's layout can hold, and the `openPane` allowlist itself), `projectPanes` (a rail source's detail
view, addressed by URL rather than held in a task's layout), and `overlays` (full-screen pickers that
belong to no task at all). The task-scoped predicate is re-exported from
`@acorn/protocol/plugin/contract.ts` rather than written a third time here, because the node's manifest
parser checks the same thing when it validates that an `openPane` names a pane the manifest declares.

## Descriptors for facts, trees for UI, rectangles for pixels

The rule of thumb, and it is a refusal as much as a guideline. **A descriptor is a fact the host
draws. A tree is UI, written in the host's own components. A rectangle is pixels the host cannot
draw.** Ask which of the three a surface is, in that order, and take the first that fits.

A status chip, a footer badge, a menu row, a palette entry: each is a fact, and each as an iframe
would cost a process-isolated document, could never look native, and would be dead whenever no frame
of that plugin happened to be mounted. So none of the small surfaces are open to frames, and the
answer to "I want a chip in the topbar" is to grow the descriptor vocabulary rather than to open a
slot id to an iframe.

A pane, a reference panel body, a settings page, a card in somebody else's list: those are UI, and
they are trees. The plugin's bundle names the host's own components and the host draws them, so the
result has the shell's keyboard handling, focus, ARIA and the reader's chosen style pack, and the
same source runs compiled in this process or sandboxed in a worker.

A PTY, a webview, a canvas, a code editor: those are pixels, and they are rectangles. The rule used
to be "descriptors for chrome, frames for rectangles", which had only two answers and pushed every
pane into an iframe by default. The middle answer is the one the layout programme added.

**A static schema and a component tree are not the same object**, and conflating them is what made the
middle answer look forbidden for so long. A static schema is Slack Block Kit or Adaptive Cards: the
plugin sends JSON saying "a card with a title and three rows", the host has one renderer per block,
and every click is a round trip and a whole new blob. It is always one field short. Somebody needs an
`if`, then a loop, then a computed value, and a bad programming language has been invented inside
JSON. That is what this page refuses as "a widget toolkit in the wire format", and the refusal stands.

A remote component tree is the other thing. The plugin's code runs in a sandbox and renders with a
normal framework against a fake DOM; the fake DOM serialises to a tree of named host components and
streams mutations. Logic stays in the plugin. Pixels, theme, focus and accessibility stay in the host.
No conditional is ever written in JSON, because the plugin's real code does the conditional and emits a
different tree. Its vocabulary is the kit, which exists and is versioned already through
`@acorn/plugin-api/ui`, so the tree adds no second vocabulary and the schema never grows an `if`. The
word "DSL" is discouraged for it internally, because the word invites the first shape; it is a
component model with more than one renderer.

**One reversal, on the record.** `docs/editor.md` argued that "the moment the host renders
a plugin's list from data, someone has to design and eternally version a descriptor vocabulary … That
request will recur; the answer stays no." That refusal was aimed at a static schema and it still holds
against one. Its other half — that a frame can always draw what a descriptor cannot — is true and
unchanged: the frame survives as the rectangle, for pixels. What the tree adds is the tier between "a
list of facts" and "an iframe", which is where a tool card, a sidebar tab and a settings section live
and where nothing lived before.

Three things were considered for that tier and refused. **A remote subtree per item at volume** — one
per diff line, one per file-tree row — would be thousands of sandboxed mounts; facts pinned to items
are annotations, which are batched, host-drawn and indexable, and a remote tree is for a card, a tab or
a section, things that number in the dozens on a screen. **The hidden iframe as the sandbox** was the
cheapest path, reusing `app-plugin://`, the CSP and the bridge and never drawing; a Web Worker won
because it has no DOM at all, is lighter per plugin, and the bridge was a transport swap. The iframe
survives only as the rectangle. **First-party plugins through the remote root** would have been the
flattest possible story, and was refused for this programme: every first-party pane would pay the
sandbox hop, and the agents transcript's performance risk would land on it. First-party renders
directly against the same API, the two paths produce the same tree, so slots and focus work across
both, and making a first-party plugin loadable stays a later per-plugin decision.

That is why the `slots` enum is two names rather than the client's six, and why the refusals are
recorded next to it in `@acorn/protocol/plugin/contract.ts`:

| Manifest slot | Host slot | Why |
| --- | --- | --- |
| `footer` | `task.footer` | The task footer — the slot `docker-footer-badge` occupies. Invisible until a task is open. |
| `topbar` | `topbar.right` | The app's status bar, beside the node chip and the notification bell. The right home for a status chip. |

Refused, deliberately: `overlay` is the full-window layer that draws the config-trust gate, the plugin
trust dialog and the command palette — a contribution there would paint over the very prompts asking
whether to trust it. `drawer` is a dock with real UI in it, and its slot context carries shell
callbacks a descriptor cannot receive. `topbar.left` and
`task.switcher.extra` are members of the client's slot union with no host rendering them at all, so a
manifest naming one would parse and never appear.

Both host slots are rows in one registry now. `task.footer` had its own registry and its own `ctx`
member until 2026-08-27; folding them left the id as the only thing that decides which context a
component receives, which is what this table already assumed.

A rail row is not on that list at all, in either direction. It used to be a client slot called
`tabrail.task-row`, and Docker was its only user; what it actually handed out was permission to draw
arbitrary markup and position it in the shell's own pixel geography, which is how Docker's marker and
core's pin ended up in the same corner. It is gone. Rail status is published as data now, through the
compiled registry described under [Rail markers](#rail-markers) below.

## Keeping a descriptor fresh

A descriptor's data comes from a route on the plugin's node half, so something has to say when to read
it again. There are three answers and they are not interchangeable.

**A declared `refresh`** is the fallback: seconds, floored at 30 and capped at a day. The floor is not
timidity — a descriptor read is one HTTP call *per node*, and one interval serves every plugin's chrome
at the lowest value anyone declared, so a plugin that asked for two seconds would be spending every
other plugin's budget as well as its own. Declare it for data that changes with nothing to trigger on.

**`ctx.events.status()`** means "re-read my chrome descriptors". The host binds it to the calling
plugin's id, so it refetches that plugin's rail rows, badges, collections and agent context on every
connected client, and nobody else's. It is right for "something happened" and wrong for "here is
another number". Use it after an action, not on a timer.

It used to be a content-free ping that refetched every descriptor of every plugin, and a terminal
flipping between working and idle fired one per edge. `bumpChrome` in
`packages/client-core/src/host/chrome/chromeData.ts` has kept a revision per plugin all along; the
socket subscription was the one caller that told it nothing.

**The plugin's own channel** is the fast path, and the one to reach for when data actually streams.

### The live channel

A loaded plugin owns the WS channel namespace `plugin:<its-id>:*`. Its node half broadcasts on it with
the `ctx.events.send` it already had, its own frames subscribe to it by declaring the channel in
`permissions.events`, and each frame that arrives nudges that plugin's descriptors and nobody else's.

```js
// node half
ctx.events.send({ channel: `plugin:${ID}:sample`, cpu: 0.34, memory: 0.81 })
```

```js
// its frame
bridge.events.on(`plugin:${ID}:sample`, (sample) => paint(sample))
```

A compiled client half hears the same channel through `onPluginFrame(pluginId, channel, listener)`
from `@acorn/plugin-api/client`. The returned disposable belongs to the model or component root that
subscribed; GitHub's pull model uses it to replace a stale detail response after the node announces
`plugin:github:pr-synced`.

What a plugin puts on the frame beside `channel` is the payload, delivered to its frames unchanged.
Core reads the channel and nothing else, which is the same promise the WS envelope makes everywhere
(`@acorn/protocol/ws.ts`).

The first-party plugins use it for one thing: announcing that state they own has changed
(`plugin:github:pr-synced`, `plugin:notes:notes-changed`, `plugin:workflows:run-changed`, and so
on). The catalogue, the payload rule (state to re-read, never a delta) and the one exception — core
sends `plugin:<provider>:items-changed` itself after a mirrored-resource refresh, because the write is
core's — are recorded per plugin in git history (`git log -- docs/future/events`); the rule
itself is § Hearing another plugin below, and the emitted verbs are each plugin's `emits`.

Four properties worth knowing before building on it:

- **`send` is confined to that namespace, and the confinement is the definition.** A loaded plugin
  naming another prefix gets a throw, not a dropped frame. Before this it could post on `term:` or
  `workflow:` and impersonate core's own streams; a built-in still can, because a built-in owns real
  prefixes through `ctx.events.channel` and is compiled into the binary.
- **A loaded plugin still cannot claim a prefix.** `ctx.events.channel` remains withheld. Core claims
  the one `plugin` prefix on every loaded plugin's behalf and routes by the id inside the name
  (`client-core/host/plugins/pluginChannel.ts`), which is what lets this work across a message-passing
  boundary that a handler function could never cross.
- **Frames get every frame; chrome gets a coalesced one.** A subscribed frame is delivered each
  broadcast, paying for it through the bridge's own message budget. Chrome is nudged at most twice a
  second per plugin, because a rail row is a network read per node and a plugin sampling in a loop must
  not turn that into a refetch storm.
- **`nodeStats` does not participate**, and neither the declared interval nor a push reaches it: Fleet
  home reads it through a fan-out with no dependency accessor, so it refetches when the fleet list
  changes and not otherwise. A node statistic is a number on a card, not a live readout.

A frame may subscribe only to its **own** plugin's channel. Another plugin's is refused, structurally,
for the same reason another plugin's routes are — two plugins that need to talk use a capability. The
trust prompt draws one host-owned sentence for the grant and never the verb the manifest named, which
is the rule for every line in that group.

## Context menus

`contextMenus` is the declarative right-click contribution, and the registry behind it
(`packages/client-core/src/host/registries/panes/contextMenus.ts`) is core's as much as a plugin's: the tab rail's
own Pin / Unpin / Rename / Archive rows are registrations on it. That is the point — a contribution
contract whose only consumer is a third party is a contract nobody has used. Both doors onto a task row
(the button menu it already had, and the new right-click) draw the same list from the same registry, so
they cannot offer different things.

An entry is `{ id, location, label, icon?, order?, when?, action }`:

- **`location`** comes from a closed vocabulary (`@acorn/protocol/contextMenus.ts`). `task.row` is the
  only member today; the list grows when a surface appears to draw it, never ahead of one.
- **`when`** is a map of literals that must *all* equal the target's own facts — not an expression. A
  manifest is data, and a predicate language would need a parser, an evaluator and a decision about
  what it may call. `task.row` supplies `origin`, `projectId` and `pinned`; naming anything else is a
  parse error, because a predicate that can never match is a contribution that installs and does
  nothing. Identity fields (`id`, `title`) are deliberately not facts: a menu row keyed to one task id
  is not an extension point.
- **`action`** is the *context-free* verb set — the same one a command and a slot badge take. A menu
  row can therefore do exactly what a command can do and nothing more. `createTask` and `navigate` are
  absent because the thing under the cursor is a **core** resource: the first needs the host's
  promotion callback over a rail item, the second a project-scoped surface of the plugin's own.
- The host binds the rest. The id becomes `plugin:<pluginId>:<id>`, so a package cannot take a core
  row's place; the row is hidden unless its plugin is running on the node being looked at; and the verb
  receives the id of the thing that was right-clicked, never an id the descriptor chose. There is no
  `tone` — a red row is a claim that an action destroys something, and that is core's claim to make
  about core's resources.

  ```json
  {
    "contributions": {
      "contextMenus": [{
        "id": "open-card",
        "location": "task.row",
        "label": "Open the board card",
        "icon": "kanban",
        "when": { "origin": "board" },
        "action": { "verb": "runNodeAction", "path": "/v2/p/board/open" }
      }]
    }
  }
  ```

Nothing here is reachable from a plugin frame. The registry is populated host-side from manifests the
device read; the frame bridge gained no message kind and no route, so a frame can neither open a menu
nor synthesise a selection on one.

## Rail markers

A **rail marker** is a small non-interactive status icon on a rail control: a task row, a rail source,
a pane button. A compiled plugin publishes markers through `ctx.railMarkers`, next to the state that
owns them:

```ts
ctx.railMarkers.register({
  id: 'docker',
  order: 50,
  markers: (target) => {
    if (target.kind !== 'task') return []
    const running = dockerTaskSummary(target.id)?.running ?? 0
    return running ? [{
      id: 'running',
      label: `${running} running container${running === 1 ? '' : 's'}`,
      icon: 'brand:docker',
      tone: 'accent',
      placements: ['top-start', 'bottom-start'],
    }] : []
  },
})
```

Three things are the host's, not the plugin's. **Where it goes**: `placements` is an ordered wish
list, and the host hands out the first entry still free, so two plugins asking for the same corner get
different corners rather than one on top of the other. **What it looks like**: `tone` is semantic, and
the host owns the colour, the spin, and the icon resolution — a plugin stylesheet positioning a rail
marker is a bug. **Whether it outranks anything**: contributed priorities are clamped below core's, so
a plugin orders its own markers among themselves and never pushes a core lifecycle state such as
"archiving" out of its slot. A marker that finds no free position keeps its place in the tooltip legend
and the control's accessible description; it loses the pixels, never the state.

Markers are descriptive. There is no click verb, because a marker lives inside a button and a button
inside a button is not a thing — the action belongs to the rail control itself, a context menu, or a
command.

The agents plugin is the other consumer, and it shows what "beside the state that owns it" buys. Its
marker is the task row's top-right corner: a turning loader while any agent in the task is moving,
replaced outright by the alert glyph the moment one needs the owner. Core used to draw that spinner
from terminal sessions alone, which meant a managed agent working away in the background left the row
looking idle. The plugin knows about both kinds, so it publishes one answer for both, in the same
shape vocabulary its pane header and task sidebar already use.

`markers()` runs inside the consuming render, so it may read signals the plugin already owns.
Registering through `ctx` rather than the registry directly is what lets the host take the markers back
out when the plugin is disabled. Loaded plugins cannot publish markers yet; the design for a batched,
node-scoped manifest contribution is in `docs/future/rail-tab.md`, and it waits for a loaded plugin
with a status worth publishing.

## Cooperative extension points

Plugin B could not add anything *inside* plugin A's surfaces, even when A would welcome it. The only
way was for A to import B, which is the coupling the registries were built to remove. Two manifest
keys close that, and the shape is the same one every other contribution has:
`@acorn/protocol/extensionPoints.ts` holds the vocabulary, the node checks it at parse, the client
checks it again on arrival, and the host mints every name.

### Five kinds, four rules

What a contributor brings is one of five things, and the kind is a field on the point:

| `kind` | What crosses | Plugin code on the client | Best for |
| --- | --- | --- | --- |
| `rows` | records | none | a list of things with names under a pane |
| `annotation` | records, keyed | none | facts pinned to items the owner already draws |
| `remote` | a tree of the host's own components | in a worker | UI inside somebody else's surface |
| `rectangle` | nothing; an iframe is placed | in its own iframe | surfaces that own pixels |
| `hook` | a payload and a verdict | none; a node route | acting before something happens |

Ask in this order. **Is it a decision, not a drawing?** A hook. **Is it a fact about one item the owner
already draws?** An annotation. **Is it a list of things with names?** Rows. **Is it UI you can build
from acorn's own components?** A remote tree. **Does it own pixels, heavy typing or a third-party
library — a canvas, Monaco, xterm, a chart library?** A rectangle.

Descriptors stay boring on purpose. When someone asks for a conditional in a row, the answer is a
remote card. The line between rows and annotations on one side and remote trees on the other is **data
versus code**, not simple versus complex — a remote card can open a `Modal`. What differs is whether a
plugin's code runs on the client, and this is what that costs:

| | Descriptor (rows, annotations) | Remote tree | Rectangle | Hook |
| --- | --- | --- | --- | --- |
| What crosses | records | a component tree | nothing; an iframe is placed | a payload and a verdict |
| Plugin code on the client | none | in a worker | in its own iframe | none; a node route |
| Needs a client bundle | no | yes | yes | no |
| Can open a modal or a menu | no | yes, host-drawn | yes, in its own overlay | not applicable |
| Cost of N contributors | N route reads, batched | N live subtrees | N iframes | N route calls |
| The host can index it | yes | no | no | no |
| Best for | facts about many items | UI in someone else's surface | owning pixels | acting before something happens |

Most third-party plugins will be a rail source, a pane, and a few remote cards. Rectangles are the
exception, not the default.

**Where a point id lives.** A point is `<ownerId>:<pointId>`, and the string a contributor spells has
to come from somewhere. Two homes, and the rule is which owner you are: core's own points and the
first-party points core's consumers say — `agents:*`, `core:*` — are in
`@acorn/protocol/extensionPoints.ts`, because both ends of the wire compile against protocol. A
plugin's own points — `changes:diff-line`, `github:diff-line`, `docker:container`,
`context:section` — are in that plugin's own `extensionPoints.ts`, because that is where the owner
lives. **A contributor in another plugin spells the string.** It cannot import the owner's module: a
plugin may not import another plugin, and that boundary is the whole reason these points exist. The
string is the contract, the host mints it from the manifest it was read under, and a typo shows up on
the plugin's page as a contribution whose point nobody declares.

All five obey the same four rules:

| Rule | What it means |
| --- | --- |
| The owner consents in its manifest | A point A did not declare has nothing delivered into it. There is no uncooperative extension. |
| The host mints every name | A point is `<ownerId>:<pointId>`, stamped from the plugin the manifest was read under. B cannot advertise a point in A's name, and B's manifest names A out loud. |
| Both sides appear in the trust prompt | With host-owned copy. A plugin id and a verb are interpolated from fixed tables; manifest text never is. |
| Code does not cross | What travels is data: rows, marks, a component tree, a typed payload. The host carries it, checks it, and draws or runs it. |

`kind` defaults to `rows`, so a manifest written before this field parses to the kind it meant.

**What each kind does in a terminal.** Both hosts read the same registry and the same arbitration; only
the drawing differs. `rows` becomes a keyboard-driven collection at the end of the owning pane rather
than a strip under it. `annotation` marks draw on the line below the item they key, because a diff line
in cells is already as wide as the panel. `remote` trees cross with full parity, and a contributor's
nodes are as reachable as the kit says they are — a `Button` is a stop, a `Text` is not. `rectangle` is
one muted line naming the point, because there is no iframe. `hook` runs on the node and neither host
draws it. `docs/tui.md` § What a plugin loses here is the table, and it is the one place that answer
lives.

### Rows

**A declares the point it hosts.** One entry, and it is all the code A writes:

```json
{ "contributions": {
  "frames": [{ "target": "pane", "id": "board", "label": "Board" }],
  "extensionPoints": [{ "id": "card-links", "kind": "rows", "label": "Linked items", "location": "pane.footer", "surface": "board" }]
} }
```

`location` is a closed list and it grows when a surface appears to draw it, never ahead of one:
`pane.footer`, a strip the host draws under a plugin pane's frame; `pane.aside`, a column beside it;
and `pane.inline-below` and `pane.inline-beside`, which hold another plugin's rectangle and belong to
the `rectangle` kind below. Position is encoded in the *name*, the same rule the frame `layout`
template family follows: an `orientation` field alongside would be the first knob of a layout language.
`surface` must be a `pane` this same manifest declares; a settings page, importer, overlay, reference
panel or webview is chrome the host already draws around a frame, with nowhere to reserve a strip. One
point per surface per location — so one pane may have several.

**The footer and the aside take two different contributors.** A footer is filled by other plugins'
`extensions`, below. An **aside is filled by the user**: the host draws a dashboard region there, and
what the owner declares is not a route to read but the constraints a person's own composition must
satisfy — `panels: { collections | fieldRole, views, max }`, defaulting to this plugin's own
collections, every view and four panels ([dashboards.md](./dashboards.md) § Placements owns that
vocabulary; a rail source declares the same block to get a panel area beside its list). An
`extensions` entry aimed at an aside delivers nothing, which is the same silent nothing every
unmatched contribution already gets.

Every region obeys one rule without exception: **the host draws them, the plugin's layout only reserves
them.** Panels and rows are host components; the frame is a separate realm. No bridge API may pretend
otherwise.

**B declares what it puts there, by id.**

```json
{ "contributions": { "extensions": [{
  "id": "board-issues",
  "point": "board:card-links",
  "label": "Linear issues",
  "items": "/v2/p/tracker/board-issues",
  "onSelect": { "verb": "runNodeAction", "path": "/v2/p/tracker/open" }
}] } }
```

`point` is `<ownerPluginId>:<pointId>`, so B's manifest names A out loud and an owner reading it at
install time can see which package this one reaches into. `items` is a GET on **B's own** namespace
answering `{ items: [{ id, title, subtitle?, icon?, badge? }] }` — display strings, nothing else.
`onSelect` is declared once, on the contribution, from the context-free verb set, so the node can check
it against B's own surfaces at parse time; the clicked row's id rides along as the item. There is no
per-item action, because that would be an unchecked verb arriving over a route.

An extension names **exactly one** way in — `items`, `remote`, `frame` or `route` — and which one is
right depends on the owner's kind, which the contributor's manifest cannot see. The node checks the
shape ("name one"), and the match between a carrier and a point's kind happens at delivery, where both
are visible.

A compiled plugin has a fifth carrier that no manifest can name: `component`, registered through
`ctx.extensions`. It fills a `remote` point, the same kind a bundle fills, because from the owner's
side and from the trust prompt's side the two are one thing: another plugin's tree of kit nodes in a
slot the owner reserved. What differs is where the code runs. A loaded plugin's bundle runs in a worker
and its tree crosses as a stream of node names; a compiled plugin's component is already in this
process and the host mounts it. The owner writes one `Slot` and cannot tell which answered. Context's
`context:section` point is the worked example, with memory as its one contributor.

### Annotations

Rows answer "what is related to this pane". Annotations answer "what do you know about this line". The
owner declares what its items are keyed by; the contributor answers with marks for the keys on screen.

```json
// A: changes declares what can be annotated
{ "id": "diff-line", "kind": "annotation", "label": "Diff line",
  "key": { "file": "string", "line": "number", "side": "string" } }

// B: coverage
{ "id": "coverage-lines", "point": "changes:diff-line", "label": "Coverage",
  "items": "/v2/p/coverage/lines" }
```

The host POSTs the keys on screen in one request and B answers marks:

```
POST /v2/p/coverage/lines  { "keys": [{ "file": "src/auth.ts", "line": 42, "side": "new" }, …] }
→ { "items": [{ "key": {…}, "severity": "info" | "warn" | "danger", "text": "Not covered by any test", "icon": "shield-off" }] }
```

Batched, so a plugin with two thousand marks answers one request. Display strings only, capped by the
host, the same rule `PluginExtensionItem` has. The lookup is minted from the **owner's** declared
fields in the owner's order, so a contributor cannot widen its own match by inventing a field.
Provenance is stamped on every mark and drawn beside it. A contributor that fails draws nothing for
itself and leaves the others alone: a mark is a note under somebody else's row, and one plugin's outage
must not blank the row.

### Remote trees

Plugin code runs in a sandbox, renders against a fake DOM, and the fake DOM serialises to a tree of the
host's own component names ([The tree contract](#the-tree-contract) owns the wire format, and
`docs/shell.md § The plugin worker` the sandbox). An owner that draws through the tree declares a point as a node:

```tsx
<Slot point="agents:attachment" key={selected?.mime}>
  <AttachmentChip file={selected} />   {/* the default, drawn when nobody matches */}
</Slot>
```

and in its manifest, so the trust prompt can say it:

```json
{ "id": "attachment", "kind": "remote", "label": "Attachment", "mode": "replace", "selector": "mime" }
```

A contributor names the point, the entry its bundle registered with `mountTree`, and what it matches:

```json
{ "id": "agent-images", "point": "agents:attachment", "label": "Image viewer",
  "remote": "attachment", "matches": ["image/png", "image/jpeg"] }
```

The host grafts the contributor's subtree at the slot node. Neither plugin sees the other's nodes, and
the contributor's code has exactly the permissions its own manifest declares — sitting inside A's pane
grants it nothing of A's. **One level only**: a contributor's tree is a stream of kit node names, and
`Slot` is not one of them, so a grafted subtree has no way to open a slot of its own.

**What a slot's tree may reach.** The host hands the contributor's tree the owner's `taskId` and
`projectId`, read-only, as its scope — the same two the host gives a rectangle occupant. Without them a
card drawn in somebody else's pane is inert: `openPane`, in-app `openUrl` and task-scoped key bindings
are all questions about a task, and a tree with no task gets `undefined` from every one of them.

They are the owner's, not the shell's. A project-scoped pane and a reference panel are not looking at a
task even while one is selected in the rail behind them, so reading the ambient task would push a pane
into a background task's layout, where the reader is not. It is the same rule a frame's bridge follows.

The scope is not data. What the owner wants the contributor to *know* goes in the slot's props, where
the owner writes the names; the scope is the host's answer to "where am I", it reaches the bridge and
nowhere else, and the contributor never reads it directly.

#### Asking the owner

Props are data, and that leaves a gap: a contributor drawing a replacement for one of the owner's own
items has no way to ask the owner to change that item. A callback prop cannot cross the worker
boundary, and pretending it could would split what a compiled and a loaded contribution mean.

So an owner declares a closed vocabulary of actions on the point, and binds a handler per `Slot` it
draws:

```json
{ "id": "attachment", "kind": "remote", "label": "Attachment", "mode": "replace",
  "actions": ["replace"] }
```

```tsx
<Slot
  point="agents:attachment"
  key={attachment.mediaType}
  props={() => ({ attachment, taskId, sessionId })}
  actions={{ replace: (payload) => replaceDraftAttachment(attachment.id, payload) }}
>
  <AttachmentChip file={attachment} />
</Slot>
```

A contributor names one:

```ts
await mount.host.invoke('replace', { expectedAttachmentId, replacementAttachmentId })
```

`solidTree` puts `host` on the component's props beside `bridge`, so a Solid tree reaches it as
`props.host` without touching the mount. Both are the same object across a props update, which is what
keeps a handler valid while it is awaiting.

Two lists have to contain the name before the host forwards anything: the point's `actions`, which is
the owner plugin's published contract, and this particular `Slot`'s handler map, which is the
instance's consent. A name in one and not the other is refused. Neither the handlers nor their names
are sent to the worker; a contributor learns which actions exist from the published declaration, names
one, and the host looks it up.

It is a request and not a setter. The owner still decides — the agent composer checks that the id it
was told to expect is still in the slot before it swaps anything — which is why a contributor never
receives a handle to the owner's state.

The bounds: payload and result each under 64 KiB, eight outstanding per slot, ten seconds for the
owner to answer. An action is scoped by the host-held slot id, so plugin code supplies no plugin,
point, owner or target id and there is nothing to forge.

**Binding on the mount, not the bridge.** One worker serves every tree its bundle draws and holds one
bridge, so a composer showing four image attachments has four trees and one port. A request sent over
the bridge could not say which of the four sent it and the host would have to guess from focus. These
ride the tree channel, where the slot is part of the address the host already trusts.

#### Companion overlays

A tree that needs a rectangle — a canvas, an editor, anything with pixels — declares one overlay of its
own plugin's on the extension descriptor:

```json
{ "id": "image-attachment", "point": "agents:attachment", "label": "Image markup",
  "remote": "attachmentPreview", "matches": ["image/png", "image/jpeg"], "overlay": "editor" }
```

```ts
const result = await mount.host.openOverlay('editor', { taskId, attachmentId })
```

`overlay` is a qualifier on the `remote` carrier, never a carrier of its own: a descriptor still names
exactly one of `items`, `remote`, `frame` or `route`. It must name an `overlay` frame the same manifest
declares, and it counts as a valid opener for that frame, so a plugin whose only opener is a companion
overlay passes the "an overlay needs an action that opens it" rule.

One name, not a list. A tree that could name any of its plugin's overlays would have a dispatcher; one
name is a grant a person can read in the manifest at trust time.

Name it as your manifest spells it. The device rewrites a frame id that sits outside your plugin's
namespace to `<pluginId>.<id>`, and rewrites the descriptor's `overlay` reference with it
(client-core/host/plugins/contributionIds.ts), but the string your tree passes is yours. The host
qualifies it the same way before comparing, so `editor` and `my-plugin.editor` both reach the same
frame and neither is refused for naming your own overlay.

The host accepts it only from a person, and at most once a second. Either the shell's focus is inside
that exact tree, or somebody pressed something in it within the last second. Two answers rather than
one because focus alone is not enough: WebKit does not move focus to a button when it is clicked, which
is the behaviour behind macOS's "Keyboard navigation" setting and the platform the desktop shell runs
on, so a focus-only gate meant a click on a kit `Button` could never open an overlay at all. A
background timer produces neither, which is the property being kept. The throttle is the same second
gate `ui.openUrl` has one rung down.

**The result lifecycle.** The overlay store holds an invocation rather than a pair of ids: an id that
keys the iframe, the opener's input, and the waiter. `openOverlay` resolves with whatever the overlay
passed to `bridge.ui.close(result)`, and with `null` for every dismissal — Escape, the backdrop, the
close button, another overlay opening over it, the source tree unmounting, navigating away. An opener
never has to tell "cancelled" from "went away", and nobody is ever left waiting.

Reopening the same overlay builds a fresh iframe keyed by the new invocation id. An editor must never
inherit the previous canvas or the previous input, or the reader has no way to tell which image they
are drawing on.

Input and result are each capped at 64 KiB and are data. An overlay that needs a file gets its id in
the input and fetches the bytes over its own plugin's route.

**A host without overlays** answers `unsupported_host`. The terminal is the case: it mounts remote
trees and has no iframe to put a rectangle in, and this project is not going to invent a cell-drawn
canvas. A contributor catches that code and leaves its static preview up, so the owner's own fallback
is what a reader sees there.

### Rectangles

After remote trees exist, rectangles are for surfaces that own pixels: Monaco, xterm, a canvas, a chart
library, a preview of arbitrary HTML. The point is a region of the owner's pane, and the frame in it may
belong to somebody else.

```json
// A: editor declares a box beside its document
{ "id": "beside", "kind": "rectangle", "label": "Beside the document",
  "location": "pane.inline-beside", "surface": "editor", "mode": "replace", "selector": "path" }

// B: markdown-preview fills it for *.md
"frames": [{ "target": "inline", "id": "preview", "label": "Markdown preview" }],
"extensions": [{ "id": "md-preview", "point": "editor:beside", "label": "Markdown preview",
                 "frame": "preview", "matches": ["*.md", "*.mdx"] }]
```

The two iframes are **siblings**; the host draws both and sits between them. An `inline` frame is
registered in no pane switcher of its own — the only thing that ever draws it is an owner's point,
which is what makes "the owner consents" true of this kind too. A manifest declaring an `inline` frame
that nothing places is a parse error, and so is an extension naming a frame it never declared.

Talking across the box is a hook with one handler, so there is one concept and not two.

### Arbitration: who fills a box

`remote` and `rectangle` points declare one of two modes.

| | `stack` | `replace` |
| --- | --- | --- |
| Occupants | every matching contributor, up to `max` | exactly one: the best match for the `key`, else the owner's default |
| Selector | optional; contributors may still filter with `matches` | required in practice; the owner passes `key` when opening |
| Example | tools beside a note; buttons in a composer | the renderer for the selected attachment |

`matches` takes an exact string, a trailing star as a prefix (`image/*`) or a leading star as a suffix
(`*.md`). A contributor that names none matches every key.

`max` matters for `stack`: each remote contributor is a live subtree and each rectangle contributor is
an iframe. Past `max` the host draws a count of what was left out — a count and no names, because the
owner set the ceiling and listing the losers would invite a person to fix somebody else's arithmetic.

When two contributors match the same key in `replace` mode, the user picks in Settings → Plugins and
**the owner's default draws until they do**. A pick naming a plugin that has stopped matching falls
back to the owner's default rather than to the runner-up: silently promoting the other candidate would
mean the box changed hands because somebody uninstalled something. An override is an offer, not a
seizure.

### What the host binds

None of it can be stated by a manifest:

| | |
| --- | --- |
| the point's public name | `<owner>:<point>`, minted from the plugin the manifest was read under. B cannot advertise a point in A's name. |
| the provenance | every delivered group and every mark is stamped with the **contributing** plugin's id and renders it beside the content. An owner looking at somebody else's items inside a pane can always see whose they are. |
| the fetch | confined to the contributor's own `/v2/p/<id>/`. A contribution cannot make the host read the point owner's routes on its behalf — the "reading another plugin's routes" refusal below is enforced by construction, not by a rule. |
| the gate | nothing is delivered unless **both** plugins are running on the node being looked at, and neither has code this device withheld. A `remote` or `rectangle` contribution additionally needs this device to have accepted the contributor's bundle, exactly as a pane does. |

**Descriptors cross; code does not.** The rows are drawn by the host, with the shell's own `Row`,
`Badge`, `SectionHeader` and `Icon`, in host markup that sits *outside* A's iframe. A never receives
B's data and B never touches A's document. That is the same rule
[first-party-plugins.md](./first-party-plugins.md) gives for why in-realm composition is banned, applied
one level up, and it is why this is an extension point rather than a hole.

**An unmatched contribution is silent.** A point that is not there — A not installed, disabled on this
node, its bundle refused here, or A dropped the point in an update — delivers nothing. No error, no
warning, nothing to catch. The two halves come from two manifests registered in an order nobody
controls, so a contribution never resolves its point at registration time; delivery is resolved at read
time, and "there is nobody on both ends of this pipe today" is one outcome with one behaviour.

Both directions appear in the trust prompt under **Enforced**, and both are recorded against the
decision so a version that starts reaching into a *different* package, or bringing a *different kind*
of thing, reads as newly requested rather than sliding past unremarked.

### Seeing what matched

Silent-when-absent is right for a user and the worst possible thing for an author: a typo in `point`
produces an empty pane and no error. **Settings → Plugins** lists every point on this node, its kind
and mode, and who fills it; every contribution whose point nobody declares, with a nearest-name
suggestion; and, for a tied `replace` slot, the picker that settles it. It reads the same registries the
hosts read and adds no bridge verb, so it can never disagree with what is on screen.

## Node-side extension points

The same model, on the node, for the same problem: plugin A opens a named point and any number of
plugins deliver into it. `ctx.extensionPoints` (`node-core/server/pluginHost/extensionPoints.ts`), with
three calls — `declare(point, label)`, `handle(point, entry)`, `handlers(point)`. They are the same
three words [hooks](#hooks) uses, because it is the same shape asked a different question
(§ One vocabulary across the registries). They were `open`, `contribute` and `entries` until
2026-08-31; those spellings still work and are deprecated.

It exists because capabilities are single-provider by construction. `ctx.capabilities.provide` throws
on a second provider, and that is correct for what a capability is — a named typed function with one
owner — but wrong for "many plugins each add a workflow step kind". Every such case was becoming a
private registry inside the plugin that needed it, each with its own duplicate check and its own
disposer convention (2026-08-27 extensibility review, finding 4).

**Reach for a capability when there is one right answer, and for a point when there are many.** And
reach for a [hook](#hooks) when the many are being asked a question rather than adding a thing: a point
collects values, a hook runs a chain and comes back with a verdict.

The rules are the client's, so there is one model to learn:

| | |
| --- | --- |
| the point's name | `<ownerPluginId>:<pointId>`. Checked against the opening plugin, so a package cannot open a point in a stranger's name. |
| the entry's id | `<contributorPluginId>:<entryId>`, minted by the host. Two plugins may use the same entry name without either shadowing the other. |
| ordering | by `order`, ties broken on id, so two entries at the same order are stable rather than dependent on init sequence. |
| duplicates | one plugin filing two entries under one id on one point throws. |
| lifecycle | both halves — points opened and entries filed — go when the plugin does. |
| resolution | `handlers()` is resolved per call, never cached at init. Contributing to a point nobody has opened yet is fine and expected: init order is not a dependency contract, so the entry waits. An unopened point reads as empty. |

The typed id lives in the owner's `contract/` and is the only thing a contributor imports, the same
`capabilityId` trick and for the same reason:

```ts
// plugins/workflows/src/contract/extensions.ts
export const WORKFLOW_STEP_KIND = extensionPointId<StepKindContribution>('workflows:step-kind')

// the owner, once
ctx.extensionPoints.declare(WORKFLOW_STEP_KIND, 'Workflow step kinds')
for (const entry of ctx.extensionPoints.handlers(WORKFLOW_STEP_KIND)) { /* … */ }

// anyone else
ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, { id: 'request', value: { handler, validate } })
```

Unlike the client's, this one carries **functions, not descriptors**, and that is not an inconsistency:
a client contribution crosses an iframe boundary into another realm, and a node contribution does not
— both tiers of plugin run in the node's own process. The rung-1 argument applies unchanged
([security.md](./security.md) § Rung 1): this is least privilege for cooperative code, not a sandbox.

Reach it only through `ctx`. A loaded plugin's bundle inlines every `@acorn/*` import it makes, so a
plugin that imported the registry module directly would get a private copy of the maps and contribute
into nothing.

The proving pair is workflows and http: workflows opens `workflows:step-kind`, `workflows:policy` and
`workflows:trigger`, and the http plugin contributes the `http:request` step, with neither package
importing the other's implementation ([workflows.md](./workflows.md) § Contributed step kinds).

## Hooks

Everything above is about drawing. Hooks are about **deciding**. "Before I push, does anyone object?"
"Before I send this prompt, does anyone want to change it?" The owner declares the moment and what is
allowed at it, contributors register a handler, and the host runs the chain and hands the owner a
verdict (`node-core/server/pluginHost/hooks.ts`).

**A hook is not an event.** An event has already happened; "task archived" cannot be blocked after the
archive. Events fan out, fire and forget, and carry state rather than deltas. A hook runs *before*, in
a chain, with a return value, ordered, timed out and validated. The two are different contracts and
they stay different: a producer that declares no `emits` has said no to listeners, and an owner that
declares no hook has said no to interceptors. An audit or analytics plugin is an event subscriber.

**The owner declares it**, in the manifest or through `ctx.hooks.declare`:

```json
{ "id": "before-push", "kind": "hook", "label": "push",
  "payload": { "taskId": "string", "branch": "string" },
  "allows": ["observe", "veto"], "timeoutMs": 5000, "onTimeout": "allow" }
```

- `payload` is the declared shape, in the same small vocabulary a remote tree's props use: `string`,
  `number`, `boolean` and arrays of those. Nothing else fits, which is deliberate — a payload is a
  decision's subject, not a document.
- `allows` is the subset of `observe | transform | veto` the owner permits. A handler asking for a mode
  not listed gets nothing.
- `timeoutMs` bounds each handler. `onTimeout` is `allow` or `deny` and applies to veto handlers only.
- `order` is `priority` (the handler's own number, then install time) or `install`. Ties are stable.
- `collect` runs every veto rather than stopping at the first, so the owner can show all the reasons.

The owner's node half calls it at the moment:

```ts
const verdict = await ctx.hooks.run('before-push', { taskId, branch })
if (!verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
await push(verdict.payload)   // transformed, or the original if nobody transformed
```

**A contributor registers a handler**, naming the owner out loud:

```json
{ "id": "scan-push", "point": "changes:before-push", "label": "Secret scan",
  "route": "/v2/p/secret-scan/push", "mode": "veto", "priority": 50 }
```

The route is on the contributor's own namespace and is called by the host with the payload. A
first-party plugin registers a function instead, through `ctx.hooks.handle`; the host wraps both in one
closure at registration and nothing inside the chain knows which it has. Two carriers, one chain — the
same shape the route registry uses.

What a handler answers:

| `mode` | Answers | What the host does with it |
| --- | --- | --- |
| `observe` | anything | dropped unread. Called alongside the chain, never in it. |
| `transform` | `{ payload }` | validated against the owner's declared shape. A violation is treated as no change and recorded. |
| `veto` | `{ ok: true }` or `{ ok: false, reason }` | `reason` is display text, capped; the host stamps `by` with the contributor's id. |

**Chain rules**, without exception:

- Handlers never see each other. Each gets the payload as it stands when its turn comes.
- Order is the owner's rule, then install time.
- Observers run alongside the chain and cannot affect it.
- A handler that throws or times out is skipped and recorded on its roster row. A timed-out veto is
  treated as `onTimeout` says. **Fail open by default**, because a plugin that stalls must not brick a
  push.
- The chain stops at the first veto unless the owner set `collect`.
- A transform's output is validated against the same shape as its input. A handler cannot turn a
  payload into something the owner did not declare.
- Both directions appear in the trust prompt with host-owned copy: "lets other plugins act before it
  pushes", "can stop a push in the changes plugin", "can change a prompt before the agents plugin sends
  it". The plugin id and the verb are interpolated from fixed tables; manifest text never is. A handler
  that changes or stops another plugin's decision is a **high** grant, the way running commands is.

The owner draws the refusal in its own UI with the provenance the host stamped. Whether "push anyway"
exists is the owner's decision: the hook says no, and the owner says what no means.

**The hooks open today.** Core owns three, because core owns the choke point:

| Owner | Hook | Allows | Who wants it |
| --- | --- | --- | --- |
| core | `core:worktree-created` | observe, transform | setup scripts. The terminal plugin's handler is the first, and used to be a single-slot capability |
| core | `core:before-tool-call` | observe, veto | approval gates beyond the built-in tiers. `onTimeout: deny`, alone among these: a gate that opens when its keeper stops answering is not one |
| core | `core:before-snapshot` | observe, transform, veto | budget shaping, PII stripping. The payload is section names, so a handler drops a section and nothing else |
| changes | `changes:before-commit` | observe, transform, veto | commit lint, message helpers |
| changes | `changes:before-push` | observe, veto | secret scanning, changesets |
| agents | `agents:before-send` | observe, transform, veto | prompt policy, redaction, context injectors |
| terminal | `terminal:before-run-target` | observe, veto | change freezes, environment checks. Runs in `RuntimeService.start`, after the repo-config trust gate and before the session is spawned |
| workflows | `workflows:before-step` | observe, veto | "no deploys today" from an incident tool |
| editor | `editor:before-save` | observe, transform, veto | format on save, lint on save |

**What is refused.** Hooks on streams or per-keystroke paths — PTY output, editor keystrokes, the agent
token stream. The events design refused those as events, and a hook costs more than an event. A
transform that changes the payload's *shape*. A hook the owner did not declare, or a mode the owner did
not allow. And hooks that run on the client: the chain is node-side, for the same reason an event is
node-emitted and never renderer-local.

**Two seams that are hook-shaped and are not hooks.** [Task checks](#task-checks) already do what
`before-archive` would, and more: a check answers with a *concern* and an opt-in cleanup plan, which a
`{ ok, reason }` verdict cannot express. Converting it would have deleted the checkbox. And the
`routeCapability` seams in `server/bridge.ts` are single-provider service bridges — `scheduler.list()`,
`sessions.archive()` — which is RPC rather than a decision; a chain in front of one would answer a
question nobody asked.

## Node providers

A plugin can declare that it knows about Nodes, and optionally that it can make and remove them:
`ctx.providers.nodes(provider)` (`node-core/server/nodeProviders/registry.ts`). This is the second
door into the fleet, beside probe-then-pair, and it is what a control-plane plugin is built from.

```ts
ctx.providers.nodes({
  id: 'machines',                                     // the host stamps `<pluginId>:machines`
  label: 'Acme Cloud',
  list: async (signal) => [/* ProvidedNode records */],
  create: async (spec, signal) => {/* … */},          // declaring create makes destroy required
  destroy: async (providerNodeId, signal) => {/* … */},
  start: async (providerNodeId, signal) => {/* … */},
  stop: async (providerNodeId, signal) => {/* … */},
})
```

The rules follow every other registry on `ctx`, plus one borrowed from
[DevPod](https://devpod.sh/docs/developing-providers/quickstart):

| | |
| --- | --- |
| the id | `<pluginId>:<id>`, minted by the host. An id containing a colon is refused, so a package cannot qualify itself. |
| `create` obliges `destroy` | validated at registration, so a provider that can make Nodes but not remove them is a load error rather than a support ticket. A person who cannot remove a machine has already been billed for it. |
| lifecycle | providers go when the plugin does, like its routes and capabilities. |
| where it runs | **node-side, on some Node, not necessarily the one the person is sitting at, and with no client necessarily attached.** Write nothing into a provider that assumes otherwise. |

That last row is a contract term, not advice, and it has two halves. Node-side, because a
renderer-side provider would put the cloud account credential in the renderer, the one place the
architecture has always kept credentials out of. And *some* Node, because the client reads this by
fanning out over every reachable Node and unioning the answers, deduped on `providerId` plus
`providerNodeId` — so a provider on a headless Node is exactly as visible as one on the laptop.
`providerNodeId` is the provider's own id for a machine, stable no matter which Node asked, which is
what makes two Nodes signed into one account show one row instead of two.

**There is no seam for a provider to say how to reach its node, and there should not be one.** A
provider returns an endpoint the host dials, pinned by the fingerprint that provider vouched for, and
the dial happens in the credential path — the one place holding the device token and the pin. A
plugin that shapes that connection is a plugin inside it, which is what
[security.md](./security.md) § The control plane keeps out everywhere else. So a provider whose nodes
sit behind a NAT has a networking problem, not a plugin problem; [future/remote.md](./future/remote.md)
owns the relay question if it ever becomes ours.

**`ProvidedNode.enrollment.deviceToken` never reaches a client.** `GET /v2/core/nodes` projects it
out — as an explicit field list, so a new field cannot leak by omission — and
`POST /v2/core/nodes/adopt` is the only way to get one. The desktop host is what calls it: the
renderer names a provider and a node id, the host fetches the endpoint, fingerprint and credential
from the Node that listed the record, then probes that endpoint and refuses a certificate whose
fingerprint is not the one the provider vouched for. So the renderer cannot introduce a Node of its
own invention, and still never sees a device token
([security.md](./security.md) § The control plane).

Confirmation for the four verbs is the client's, drawn from the `ToolRisk` tiers `nodeActions`
already uses (`NODE_LIFECYCLE_RISK` in `packages/protocol/src/nodeProviders.ts`): `create`, `start`
and `stop` are `write`, and `destroy` is `execute` and asks twice. Core decides those tiers, not the
provider — a provider that could call its own destroy `read` would be choosing how loudly acorn warns
about it.

The reference implementation is `plugins/nodes-file`, which reads Nodes out of a JSON file named by
`ACORN_NODES_FILE`. It is not a toy: it is the seam's only consumer until a cloud plugin exists, it is
what the tests run against, and it is deliberately a loaded plugin whose manifest grants it nothing at
all. Build it into a data root with `pnpm --filter @acorn/node build:plugin nodes-file`; it is not in
the bundled roster, so a shipped install has no node providers and Settings → Nodes draws no
provider section.

### The first-party rule

**A first-party control-plane plugin gets no host privilege a third party lacks.** It is a loaded
plugin, built only from the seams documented here, and if it ever needs one special host change then
that change is a moat and the seam is not finished. The reason is not fairness, it is rot: a privilege
nobody outside exercises is one nobody notices breaking.

The way to check it is to diff what the plugin imports and what its manifest grants against what
`create-acorn-plugin` scaffolds. `plugins/nodes-file` is the standing worked example — one
registration, `core: []`, `secrets: false`, `exec: false`, `net: []`.

## Replacing a core surface

The other half is bb's exclusive slot, and the important word is *offer*. A plugin may declare a
replacement for one of acorn's own designated surfaces:

```json
{ "client": "./dist/client.js", "contributions": { "frames": [
  { "target": "coreSlot", "id": "board-rail", "label": "Board task list", "coreSlot": "rail.taskList" }
] } }
```

**Registering seizes nothing.** Three plugins may all offer to replace the rail's task list and the
rail keeps drawing its own. The user picks a provider in **Settings → Plugins → replaced surfaces**,
and that choice is a device preference — which list a person looks at is a property of the screen they
are looking at.

The picker lives in Settings → Plugins, not Appearance, because of what the choice is about.
Appearance's colour and shape axes exist whether or not anything is installed; this picker's options
are named after installed plugins and exist only because something is installed. It is hidden
entirely when nobody has offered a replacement, since a select with one option cannot do anything and
a permanent "no plugin replaces your task list" row would be chrome earning nothing.

**Core is the fallback in the strong sense**: not "when nothing is set" but whenever anything at all is
off. Nobody chosen, the chosen plugin not installed on this node, installed but disabled or untrusted,
or its surface threw while rendering — all four draw core's own implementation, and the settings row
says so when the last one is why. A provider that threw gets another attempt at the next contribution
sync, which is the one moment its bytes can have changed.

`rail.taskList` is the only designated surface, and the list grows the way every other vocabulary in
this document does: when a second surface has both a reason and a fallback worth writing.

## There is no uncooperative extension

On the record, because the absence is the feature. **Nothing lets plugin B alter plugin A's UI or
behaviour without A's declared consent.** Specifically refused, permanently:

- **DOM access into another realm.** bb's de facto universal mechanism is content scripts — any plugin
  may rewrite any other plugin's rendered DOM. bb documents its version honestly as "trusted
  same-origin page code, not a security sandbox," and that honesty is the whole problem: it makes
  every plugin part of every other plugin's attack surface, and it makes A's behaviour undebuggable
  from A's own source.
- **Patching another plugin's registrations.** A plugin's contributions are registered by the host from
  the manifest the host read. There is no runtime door onto anyone's, including its own.
- **Reading another plugin's routes.** Refused at manifest parse, refused again on the device, and
  refused a third time at the frame bridge (`packages/client-core/src/host/frames/scopes.ts`).

If a real need surfaces that cooperative points cannot express, **the answer is a wider vocabulary, not
an open realm** — and which vocabulary depends on which of the three tiers it is. Memory's section
inside context's tray is the worked example: editable inputs, a select, a textarea and a two-button
gate per proposal, which is UI rather than a descriptor. Growing descriptors until that fits would have
built a widget toolkit in the wire format. It is a `context:section` contribution instead, drawn from
kit nodes, and the same source would work from a worker if memory were ever loaded rather than
compiled.

Nothing here is reachable from a plugin frame. The registry is populated host-side from the manifests
and contributions the device read; the bridge gained no message kind and no route, so a frame can
neither read a point's deliveries nor contribute to one.

## Client authoring and the UI kit

The repository package builder applies one client transform, and it compiles for the tree path: the
Solid preset is told `generate: 'universal'` with `@acorn/plugin-api/ui/tree` as its module, so JSX
becomes acorn's own node names rather than DOM. A direct `solid-js` dependency is intentional and is
not the duplicate-Solid-in-one-realm hazard the shell dependency rules prevent: a frame's origin and
document are a separate reactive realm, and a tree's worker is a separate thread.

Each plugin used to name a `framework` key that the builder mapped to a transform. Phase 9 of the
layout programme deleted it, because the remote adapter is the only target and the key had one legal
value. A bundle drawing a rectangle is unaffected: it writes no JSX, so the transform has nothing to
rewrite, and a tree built through the SDK's own node functions rather than JSX is in the same
position.

A tree imports its nodes from `@acorn/plugin-api/ui/tree` and **must not** import
`@acorn/plugin-api/ui`: that barrel is components compiled for a document, and a tree bundle's own
preset would compile one into a tree of its own. A frame is the other way round — it imports the
components, as it always did. Either way the workspace dependency is the accepted intermediate
package location; the kit will be published separately for external plugins later, and only that
import name is expected to change. Do not copy the primitives or hand-roll replacements while
packaging catches up.

A tree needs none of this, and that is the point: the host draws the nodes, so the reader's theme,
style pack and density are already applied and there is nothing to bridge. What follows is the frame
path only.

The shell owns the frame document and links `/ui.css`, a stylesheet assembled at build time from
the same presentation-only primitive, tabs, picker, modal, copy, diff, and style-pack CSS the shell
uses. The appearance bridge applies the complete theme, style and invariant token projection to the
frame root. A frame may add its own CSS for its own markup, but it neither bundles nor versions a copy
of acorn's UI-kit CSS. A frame written without Solid can use the same emitted class contract without
sharing a JavaScript framework.

No plugin in this repository has a stylesheet, and an arch rule holds that: a plugin draws kit nodes,
which take no `class` and no `style`, and a plugin that ships CSS has written an element to hang it
on. Two more rules go with it. No plugin draws a raw `div` or `span`, checked by
`kit/lib/adoption.test.ts`, and no plugin mounts a Solid root of its own, because a root the host does not
know about sits outside every focus group and no intent reaches it.

Loaded-plugin commands and shortcuts are host-bound manifest data. A command id `search` becomes
`plugin.<plugin-id>.search`; plugin code cannot claim a first-party command id. `palette` controls
whether the command also appears in the palette (default `true`). A keybinding may target only a
command from the same manifest, uses the canonical `meta+ctrl+alt+shift+key` spelling, and must include
`meta`, `ctrl`, or `alt`:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "editor", "label": "Editor" }],
    "commands": [{
      "id": "search",
      "title": "Editor: find in files",
      "category": "action",
      "palette": true,
      "action": { "verb": "openPane", "pane": "editor" }
    }],
    "keybindings": [{
      "command": "search",
      "defaultChord": "meta+shift+f",
      "when": "surface",
      "surface": "editor"
    }]
  }
}
```

`when` is `global`, `task`, or `surface`; loaded plugins cannot request `typing-exempt`. Command and
binding ids must remain stable across versions because the qualified binding id is the key in the
user's persisted override map.

The older `contributions.palette` array remains an alias for a command with `palette: true`, and it
never produces a second row. It survived the `10` bump on purpose: a removal is a major on its own
announcement, and folding it into a batch bought for something else would take it off manifests
written against a number that never said it was going. Nothing in the host branches on it — the
registration pass rewrites each entry into a command descriptor before anything else sees it — so it
costs one `flatMap` and no second code path.

### Command kinds

A command descriptor carries an optional `kind`. Omitted, or `action`, it is one closed verb the host
runs, which is what every command was before 2026-09-03 and what every already-installed manifest
still parses as. The other four are additive:

- **`group`** holds children and has no action of its own. Any command may name a `parentId`, which
  must be a group in the same manifest; cross-plugin parenting is refused, and a missing parent, a
  parent that is not a group, and a cycle are each an install-time error and a dropped command on the
  device.
- **`search`** names a GET `route` in the plugin's own namespace and one static `onSelect` verb. The
  host debounces the typing, sends `q` plus the identifier the declared `scope` owns
  (`taskId`, `projectId` or `workspaceId`), and renders
  `{ items: [{ id, title, subtitle?, icon?, badge?, ref?, taskId?, projectId?, workspaceId? }] }`.
  `placeholder`, `minQueryLength` (0–20) and `debounceMs` (150–1,000) are optional; the host caps the
  rendered set at 50 rows. `onSelect` takes a command's verbs plus `navigate`, which no other command
  may name: picking a row supplies the selected row, and a project-scoped search already ran against a
  routed project, so both halves of a project-surface address exist here. The path is minted from the
  pattern the host registered, with the row's own id as the item — a response still chooses nothing.
- **`input`** names a POST `route` and one static `onSuccess` verb. The host sends
  `{ input, taskId? }` when the reader presses Enter and expects `{ ok: true, item?, message? }`; a
  failure is the ordinary error envelope, keeps the reader's text on screen, and runs no action.
- **`setting`** names a GET `readRoute`, a PUT `writeRoute` and 2–32 static
  `{ value, label, keywords? }` choices. The host GETs the read route when the frame opens and PUTs
  the write route with `{ value, taskId?, projectId?, workspaceId? }` when a choice is picked; both
  answer `{ value }`. The value has to name one of the declared choices — the host checks its own copy
  on the way out and on the way back, so a route that starts answering with something new cannot add a
  choice nobody reviewed. Two choices spelled the same way is an install-time error. A Boolean is two
  choices, `On` and `Off`, not a toggle. Secrets and free-form values are not this variant: they need
  secure input, a reveal policy and recovery that a list of labelled choices does not have.

`scope` is `none`, `task`, `project`, `workspace` or `node` (the default). A command whose scope names
an identity the palette session does not have is not offered. `fleet` is not a scope a manifest may
name: fanning a plugin's route out over every paired node is not a decision a declaration makes for
somebody else's network.

A route's answer never chooses behaviour. Every field but the ones listed above is dropped before the
row is rendered, malformed rows are dropped individually, and the verb that runs when a row is picked
or a submission succeeds is the static one the manifest declared. A search, an input or a setting
needs a `node` entrypoint, because only a node half serves `/v2/p/<id>/`.

```json
{
  "contributions": {
    "commands": [
      { "id": "issues", "title": "Linear", "category": "navigation", "kind": "group" },
      {
        "id": "find",
        "title": "Linear: find an issue",
        "kind": "search",
        "parentId": "issues",
        "scope": "project",
        "route": "/v2/p/linear/issues/search",
        "placeholder": "Search issues…",
        "onSelect": { "verb": "navigate", "surface": "linear-issue" }
      },
      {
        "id": "grouping",
        "title": "Linear: group issues by",
        "kind": "setting",
        "parentId": "issues",
        "scope": "project",
        "readRoute": "/v2/p/linear/issues/grouping",
        "writeRoute": "/v2/p/linear/issues/grouping",
        "options": [
          { "value": "status", "label": "Status" },
          { "value": "assignee", "label": "Assignee" }
        ]
      }
    ]
  }
}
```

A compiled plugin declares the same five kinds as typed objects through `ctx.commands.register`,
which stamps the owner so a plugin cannot claim another contributor's group as a parent. Its `search`
gets a live callback rather than a route, so it may query whatever its client already has: a plugin
whose rows are on the device spreads `localSearch` from `@acorn/plugin-api/client` and gets one fetch
when the frame opens, no debounce and no minimum query; a plugin asking its node writes `query`
itself and keeps the defaults, because every keystroke is then a request. A `setting` shares the
reader and writer its Settings page already uses. The first-party catalogue is in
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md).

The webview manifest shape is:

```json
{
  "target": "webview",
  "id": "docs",
  "label": "Docs",
  "url": "https://docs.example.com/",
  "hosts": ["docs.example.com", "*.example.com"]
}
```

A project-scoped pane needs three entries that refer to each other, and all three are checked when the
manifest is parsed:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "linear-issue", "label": "Linear issue", "scope": "project" }],
    "routes": [{
      "id": "linear.issue-route",
      "path": "/p/:projectId/x/linear/issues/:identifier",
      "surface": "linear-issue",
      "item": "identifier",
      "order": 60
    }],
    "sources": [{
      "id": "linear-issues",
      "label": "Linear",
      "order": 20,
      "items": "/v2/p/linear/rail-items",
      "onSelect": { "verb": "navigate", "surface": "linear-issue" }
    }]
  }
}
```

What the frame receives is unchanged: `bridge.context.projectId` and, when the URL addresses one,
`bridge.context.item`; every later selection arrives as a `select` message rather than a remount. A
project-scoped surface never gets a `taskId`, which is how a frame that draws both scopes tells them
apart without asking. Its `label` and `glyph` are currently unused — a task pane's label names its
switcher entry, but a project-scoped surface is drawn beside its own rail list, which already carries
the plugin's labels — so do not expect them on screen. The `x` segment is reserved by core for exactly this, and the prefix is derived
from the plugin id alone — a manifest cannot name it.

A source may instead offer a **panel area beside its list** — a dashboard the *user* composes, drawn by
the host with its own components, under constraints the source declares:

```json
{ "contributions": { "sources": [{
  "id": "linear-issues",
  "label": "Linear",
  "order": 20,
  "items": "/v2/p/linear/rail-items",
  "panels": { "fieldRole": "status", "views": ["list", "board"], "max": 6 }
}] } }
```

`panels: {}` is the whole opt-in and means this plugin's own collections, every view and four panels;
the block is the same one a `pane.aside` extension point takes, and
[dashboards.md](./dashboards.md) § Placements owns what it means. **Instead**, not as well: a source
declaring both `panels` and a `navigate` `onSelect` is a parse error, because the detail half of a
master/detail browse is drawn in exactly that rectangle. A source that declares neither is
pixel-identical to what it was before the key existed.

An `overlay` surface is a full-screen picker — the shape the editor's ⌘P file palette has as a compiled
contribution. The host draws the backdrop, the box, the title and the dismiss affordance; the frame draws
only its contents, because an iframe cannot position itself against anything outside its own rectangle
(the same argument that makes `refPanel` a frame target). It has no click site of its own, so the one
thing that opens it is the `openOverlay` verb, and a manifest declaring an overlay nothing opens is a
parse error rather than a surface nobody can reach:

```json
{
  "contributions": {
    "frames": [{ "target": "overlay", "id": "files", "label": "Go to file" }],
    "commands": [{
      "id": "open-files",
      "title": "Go to file",
      "action": { "verb": "openOverlay", "overlay": "files" }
    }],
    "keybindings": [{ "command": "open-files", "defaultChord": "meta+p", "when": "task" }]
  }
}
```

One overlay is on screen at a time — opening a second replaces the first, because two would leave the
reader unable to tell which one Escape dismissed. Escape and the close button are the host's; the frame
dismisses itself with `acorn.ui.close()` once its picker has picked, which is the one importer verb an
overlay also gets (`done`, the host's post-import refresh, stays importer-only). The overlay is bound to
the task that was active when it opened, so `bridge.context.taskId` is there for a picker whose job is
to put something into one.

A frame surface may also declare the modified chords its own UI handles:

```json
{
  "target": "pane",
  "id": "editor",
  "label": "Editor",
  "claimsKeys": ["meta+f", "meta+shift+f"]
}
```

The frame SDK begins with that declared set and `acorn.keys.claim([...])` may narrow it at runtime.
It cannot add undeclared keys. `meta+k`, `meta+,`, `meta+1`–`meta+9`, and `escape` are never claimable.
All other keydowns are forwarded to the shell's one dispatcher, so global and plugin-surface shortcuts
continue to work while the iframe has focus. Claims are disclosed in the device trust prompt and in
Settings → Shortcuts.

`urlSource` replaces `url` when the start URL is dynamic and must be inside the plugin's own
`/v2/p/<id>/` namespace; it answers `{ "url": "..." }` and receives task/project ids as query
parameters when present.

When a plugin has a client bundle, frames, webviews, and descriptors are gated on trust, per device and per
bundle: first sight of a `(plugin, hash)` pair prompts before anything registers, an update re-prompts
with the permission diff, and a rejected bundle gets neither frames nor chrome. A descriptor-only
plugin has no client bytes to trust and registers its data directly. The prompt renders the node-half
permissions, enforced UI scopes and key claims, and webview host grants as **three separate lists**. Webview hosts are
enforced but the remote page has live network access, so folding them into the networkless UI list
would be misleading. For the original two groups, only the second is enforced —
`packages/client-core/src/host/trust/permissions.ts` explains why they must never be merged, and it
classifies every line against what the host can actually grant rather than echoing manifest text.

Two behaviours that surprise authors, both deliberate: the `footer` slot is the **task** footer
(the slot `docker-footer-badge` occupies), so a badge is invisible until a task has a worktree; and
across a fleet exactly one bundle per plugin id is active — highest version at this plugin-API
major, chosen at boot and stable for the session — because contribution ids are un-namespaced
persisted layout keys and two versions registering at once would collide on them.

Client initialization for compiled-in plugins is synchronous registration. The host exposes contribution
points for panes, sources, settings pages, slots, extension points, extensions, provider reference
panels, agent contexts, schedules, persisted-state slices, Node statistics, attention
sources, brand marks, and content links. `slots` is one point for both shapes: the
slot id decides whether the component receives the shell context or only a task id (`docs/frontend.md §
Registries and plugins`). `schedules` is the same word the node half uses for the same idea, taking a
raw `intervalMs` because a renderer poll is not a node cadence (`docs/schedules.md § Cadence`).

`extensionPoints` and `extensions` are the compiled halves of the two manifest keys of the same name,
and the host stamps the same fields either way in: it mints `<pluginId>:<id>` for a point from the
plugin that registered it, and stamps `pluginId` on a contribution. A compiled contribution's carrier is
a `component`, which is the only one available to code already running in this process. See §
Cooperative extension points for the five kinds and for what the two render paths have in common.

`ctx.contribute(registry, entry)` is the escape hatch beside them, and the line it sits on is: a
registry the HOST owns gets a named member, and `contribute` is for a registry another PLUGIN
published. Core's own two targets, brand marks and content links, took names on 2026-08-27; before
that the line was drawn nowhere and every count of the contribution surface was two short. An activation pass handles subscriptions or local storage initialization after all descriptors
exist.

A contribution that names a provider must name its own plugin. `registries/extensionPoints/plugin.ts`'s
`declaredProvider` stamps `providerId` from the plugin that is activating, never from a value the
contribution itself carries, the same way a Node route is confined to its own path. Without it a
plugin could claim another plugin's integration rows, which is what `providerId` otherwise selects a
rail source on.

**`persistedStateSlices` has no manifest form, and will not get one.** A slice is not a value — it is a
`{ codec, empty, unknownIds, maxBytes, binding: { values, hydrate } }` record the host drives
through its own restore phases, reading and writing SHELL SIGNALS at boot before any frame exists, and
clearing them on scope eviction. None of that survives a port: a descriptor cannot hand over a codec, and
a frame is not mounted at the moment the phase it would belong to runs. A loaded plugin's answer is the
frame's `state.get`/`state.set` verbs into its own `plugin:<id>:*` namespace, which are the same prefs
the Node half's `prefs` facet reads — durable, per-node, capped at 1 MiB, and shared between a plugin's
two halves. What it costs is the orchestration: the frame reads its own state when it mounts instead of
being hydrated before first paint, and it clears its own keys instead of the host doing it on eviction.
That is a real difference and the reason the editor's open-file tabs cannot simply move as they are.

A source may also contribute routes. Two rules keep that seam honest. A route ADDRESSES an item inside a
surface — it must never gate whether the surface renders, because the rail selects a source by signal and
never navigates, so a render gated on a route match is unreachable. And a source scopes itself to the routed
project, rendering at core's `/p/:projectId` alongside every other source; its own paths hang below that
(`/p/:projectId/pulls/:number`, `/p/:projectId/issues/:identifier`). Core's URLs are constants in
client-core, not registry lookups, so a contributed route can never be resolved in core's place. The one
question core asks back is `SourceContribution.taskPath`: where a task the source owns should live.

## Task checks

A plugin that knows something about a task the owner is about to archive says so through a **task
check**, and that is the only way anything gets into the archive dialog.

```
GET  /v2/p/<id>/archive/check?taskId=…   → { concern } | { concern: null }
POST /v2/p/<id>/archive/apply            ← { taskId }
```

Two feeders, one registry, exactly like schedules and collections: a compiled plugin calls
`ctx.taskChecks.register({ id, check, apply? })`, a loaded one declares `contributions.taskChecks` in
its manifest and the host synthesises the same registration over the two routes above. Nothing
downstream can tell which one answered. The registry is
`packages/node-core/src/server/pluginHost/taskChecks.ts`; the dialog it feeds is
`packages/client-core/src/host/registries/shell/willPhase.tsx`.

A concern is plain data:

```ts
{ id, message, severity: 'warn' | 'danger', details?: string[], detailsMore?: number,
  action?: { label, checked } }
```

`details` is what the dialog lists under the message — changed paths, container names — capped at
five, with `detailsMore` counting what did not fit so the host draws "+7 more" and no plugin has to
invent that string. `action` draws a checkbox, and the cleanup behind it is `apply`, run by the
archive itself after the repo teardown script and **before the worktree is removed**, so a cleanup
that needs the worktree still has it.

There is no callback anywhere in that shape, and that is the design rather than an omission. The
action a concern offers is a route declared once — on the context or in the manifest — where the node
can confine it to the plugin's own namespace and re-confine it on every dispatch. An action arriving
inside a response body is an action nothing checked; the same rule
[extensionPoints.ts](../packages/protocol/src/extensionPoints.ts) states for why an extension item
carries no per-item verb.

**What the host binds and a plugin cannot state:** the plugin id on every concern, the qualified id
`<pluginId>:<checkId>:<concernId>` the client hands back to name a cleanup, the route namespace, and
the deadlines. `severity` IS the plugin's to declare — unlike a context menu's absent `tone`, a plugin
saying "danger" is making that claim about its own data, not about a core resource.

**Every deadline is a race and not merely an abort.** The `AbortSignal` a check receives is a
courtesy: a check that watches it can stop early, and a check that ignores it — which is most of them
— would otherwise leave the dialog waiting forever. Two seconds for a check, because a person is
watching; sixty for a cleanup, because by then the dialog is gone. A check that is slow, throws, or
answers with something unusable contributes no row, which is also what a check that found nothing
contributes. A cleanup that fails names its plugin in the archive result: `ok` stays true, because the
task IS archived, and the owner is told what did not happen.

Declaring a check earns one line in the trust dialog, under `Declared` beside the schedules and for
the same honest reason — the host holds the confinement and the deadline, but what runs is the
plugin's own node code. `cleansUp` is part of the recorded grant, so a version that starts offering to
change something where it used to only warn reads as newly requested.

Four per plugin, the same ceiling as schedules. Both routes are confined to the plugin's own namespace
at manifest parse and again at every dispatch, and a manifest declaring a check with no `node` half is
a parse error rather than a check that 404s on every archive.

Three checks ship today: docker (running containers, with a `compose down` cleanup), changes
(uncommitted files, naming the first five paths — advisory, because committing or discarding on the
owner's behalf is exactly what a confirmation exists to avoid), and terminal (active sessions —
disclosure, since core stops them itself).

The client-side seam this replaced, `registerWillHandler`, is still on `@acorn/plugin-api/ui/host`
and is still what core uses for the two events that have no node meaning: the app quitting and a
workspace being removed. No plugin should use it. It hands the caller an unregister function nobody
was obliged to hold, and the one plugin that used it dropped the function, accumulated a handler on
every re-activation — twice per boot and once per node switch — and drew its warning twice.

## Harnesses

A plugin adds a managed agent — an ACP-speaking CLI acorn drives, with a full transcript, permission
prompts and plans — by declaring `contributions.harnesses`. It is the cheapest node-side contribution
there is: no route, no bundle, no build step.

The two-feeder pattern again, with one difference that matters. A compiled plugin registers a launch
spec directly with the driver registry in plugins/agents; a loaded one declares the harness in its
manifest and the host synthesises the registration through a host-only seam (`HostPluginContext` in
`server/pluginHost/types.ts`; there is no `ctx.harnesses` for a plugin to call). The difference is where
the registration lands: schedules, collections and task checks land in a node-core registry, and a harness
lands in **another plugin's**, through the `agents.harnessRegistry` capability that plugins/agents
publishes. The contract is `packages/node-core/src/server/pluginHost/harnesses.ts`, in node-core rather
than in the agents plugin because the host is what delivers a harness and neither package may import
the other.

The host does three things a plugin cannot do for itself, and nothing else:

- **Mints the id** as `<pluginId>:<harnessId>`, the same rule extension points follow. That value is
  persisted onto every session row, so a manifest must not be able to choose it.
- **Resolves an adapter entry** inside the contributing package, with the lexical and symlink
  confinement every manifest path gets. A descriptor whose entry escapes its package is dropped with a
  warning rather than failing the boot — it is one harness of a package that may contribute other
  things.
- **Turns a probe route into a call**, because a descriptor names a route and only the host can
  dispatch one with no client in sight. The answer arrives at plugins/agents as `unknown` and is parsed
  there: they are bytes a plugin wrote.

Resolved at delivery time and never cached. With agents disabled, a contributed harness is the same
silent nothing every unmatched contribution is, and re-enabling redelivers.

**A harness package with no node half still gets a plugin row.** This is the one place the loader
produces a plugin from a manifest alone (`server/plugins/loader.ts`): a no-op `init`, no storage, and
everything else a plugin row carries — a line in Settings → Plugins, an owner who can disable it, and
registrations that roll back with the rest. Delivering such a package beside the host instead would
mean reimplementing all of that. A manifest-only package may not take a built-in's id, because there
is nothing in it to run in that built-in's place.

The trust line sits under `Enforced`, not `Declared`, and it is the only line in that group that names
a program: the host spawns exactly the declared command with the declared arguments, and the plugin
never gets a process of its own. The grant key is the whole spawn plus the environment passthrough, so
swapping the binary, changing its arguments or widening a glob all read as newly requested.

Four per plugin, the same ceiling as schedules and task checks.
[managed-agents.md § Harnesses](./managed-agents.md) owns the behaviour and the two driver tiers;
[plugin-authoring.md § Harnesses](./plugin-authoring.md) is the authoring contract.

## Forward compatibility

**Unknown is retained and reported, never dropped silently.** One rule, because there were four
different answers to "the plugin knows something this build does not", and three of them were wrong in
different directions.

- A **schedule state row** whose declaration is gone is retained and shown. Right, and the model for
  the rest: disabling a plugin must not delete the owner's pause or its run history.
- An **unknown `apiVersion`** used to hard-refuse. Fixed by making it a range (§ What is published):
  refusing meant a manifest written for the next acorn could not name this one.
- An **unknown `permissions.node.core` facet** is skipped by `scopeCore`, and an **unknown manifest
  key** is stripped by the schema. Both of those are correct — rejecting either would make a manifest
  from a later build fail to load, which is the trap `apiVersion` used to be. What was wrong is that
  neither said so, so an author whose key never took effect had nothing to read.

So the manifest reader now collects them. `parsePluginManifest` returns an `unknown` list alongside the
manifest — unknown top-level keys, unknown contribution kinds, unknown core facets — computed by
comparing the raw JSON with what came back out, so there is no key list to keep in step. It rides the
roster row to the device, which raises one attention row per entry on the same path a surface that
failed to register takes. The wording says what it is: this version of acorn does not recognise it, so
it was ignored. Not a failure of the plugin.

## Collaboration rules

Plugins collaborate through four mechanisms:

1. **Contracts** — import only a provider's `contract/` entrypoint for types, capability IDs, or
   narrow pure functions.
2. **Capabilities** — resolve typed functions from the Node's per-runtime capability registry at
   call time. This is the Node's only late-binding mechanism: route handlers receive a read-only
   capability view through `RuntimeBindings`, while plugin providers register during `init`. Missing
   optional providers produce a degraded feature, not a module import. The small helpers in
   `server/bridge.ts` are typed route adapters; their setter functions exist only for isolated route
   tests and are never used by production composition.
3. **Broadcasts** (`ctx.events`) — tell connected clients that something changed, and hear what core
   says changed on this node. It is an invalidation channel over the authenticated WebSocket — no
   durability, no replay, no delivery guarantee — and a client that misses one refetches after the
   gap. Durable history belongs in the owning plugin's tables. Two plugins that need to talk use a
   capability (2); the send side is deliberately not a plugin-to-plugin channel.
4. **Client registries and slots** — register UI contributions without importing another plugin's
   implementation. The host records disposables so disabling/reloading a plugin removes its entries.

`packages/client-core/src/infra/node/clientCapabilities.ts` mirrors capabilities (2) on the client: a typed
`Map` keyed by `ClientCapabilityId<T>`, so one plugin's client half can call another's without an
import edge between their packages. The motivating case was the agent task sidebar merging
`plugins/workflows`' steps into its roster while `plugins/workflows`' node half already needed
`plugins/agents` to execute a session, two legitimate couplings pointing opposite ways, which is a
package cycle that turbo refuses to build. Routing one direction through a capability id breaks the
cycle.

It carries the node registry's four verbs behind `ctx.capabilities` — `provide`, `get`, `require`,
`ids` — so an author who learned one half does not get the other backwards. `clientCapability` and
`requireClientCapability` are the same reads as free functions, for a component that has no `ctx` in
hand. What it is emphatically NOT is the platform gate: that is `requires` on a contribution, answered
by `hostCapabilities()`. Both were spelled "capability" until 2026-08-27, in opposite senses on the two
halves.

**A capability id belongs to the plugin that publishes it.** A loaded plugin may only provide ids
starting with `<its own id>.`, the same binding the host already applies to its routes, schedules,
collections, integration flows and extension points. Providing anything else fails registration and the
reason lands on the roster row. Without the rule, a package called anything at all could publish
`github.mirror` or `preview.rules` while the real plugin was disabled, and the composition root would
resolve the impostor — a capability is a typed function another plugin calls, so squatting one is not a
name clash, it is a substitution nothing announces.

Two ids are exempt, and both are host-declared invitations rather than any plugin's property:
`core.taskWorktreeCreated` and `agents.harnessRegistry`. Whichever plugin owns worktree side effects or
agent sessions on a given node fills them. `HOST_OWNED_CAPABILITY_IDS` in
`packages/node-core/src/server/plugins/permissions.ts` is the list, and a test holds it against the real
constants.

The catalogue of every id the first-party plugins publish, with its signature, is
`CapabilityCatalogue` in `acorn-plugin-types`. It lives there because eleven of the fourteen are
declared in `plugins/*/src/contract/` modules a loaded plugin cannot import, so prose was the only way
a stranger could learn one existed.

**Hearing a core event.** `ctx.events.on(event, listener)` is the receive side, and it fires whether or
not a client is attached, which is the point on a node nobody is sitting at. The event must be one core
publishes (`NODE_EVENT_CHANNELS` in `packages/protocol/src/nodeEvents.ts`) and, for a loaded plugin,
one its manifest named in `permissions.events`, the same grant list its frames subscribe against, so
there is one vocabulary and one trust sentence per grant rather than two of each. Disposal follows
unload, exactly as a route registration does. The catalogue is in `nodeEvents.ts`.

Two of the nine are worth calling out because they are what a coarser ping split into.
`terminal:sessions-changed` says a session was created, exited, or flipped between working and idle.
It is the one core channel that fires at machine speed, so hear it only if a session roster is what
you draw. `worktree:status-changed` says something under a task's worktree changed, and carries the
`taskId`. Announce that one with `ctx.events.worktreeStatus(taskId)` after your plugin writes under a
worktree, and drop the node's coalesced `git status` for the path first if you wrote to it directly:

```js
import { invalidateWorktreeStatus } from '@acorn/plugin-api/node'

await writeFile(join(root, path), text, 'utf8')
invalidateWorktreeStatus(root)
ctx.events.worktreeStatus(taskId)
```

The order matters. The announcement is what makes every client re-read, and they must not be handed
the answer from before your write. See [Worktree status reads](./workspaces-and-tasks.md#worktree-status-reads).

**Hearing another plugin.** The same `on` takes `plugin:<id>:<verb>` when the producer declared the
verb: a loaded plugin under a top-level `emits` key in its manifest, a built-in through
`NodePlugin.emits`. The subscriber names the channel in its own `permissions.events`, and the trust
prompt draws one host-owned sentence per producer, "Receive live updates from the github plugin". A
producer that is running and did not declare the verb makes the subscription throw; one that is not
running delivers nothing and errors nothing, which is tolerable only because payloads carry state and
the consumer re-reads on receipt. The frame side honours the same grant through the broker, and it does
not consult the producer's `emits`: a producer's frames reach every socket regardless, so the check
would be cosmetic, and the node-side check is the one that holds. One ceiling to know: init order is
not a dependency contract, so a consumer that subscribes before its producer's init has run sees an
"absent" producer and is admitted even for an undeclared verb. The frames never arrive, so the contract
holds; only the error is lost. What remains unbuilt is in [docs/future/events.md](./future/events.md).

**What earns a place in the catalogue.** An event is admitted only if all four hold: core (or the
emitting plugin) is the only possible observer; it is human-scale, not machine-scale (per commit, yes;
per keystroke, per agent step, per container health check, no); it carries state rather than a delta,
so a missed frame self-heals on re-read, which is the promise the WS envelope already makes; and one
honest host-owned sentence describes it in the trust prompt. Rule two is partly a property of the pipe:
`wsBroadcast` walks every open socket with no subscription filter and no backpressure, so a frame every
few seconds is a stream, and streams stay with the one plugin that owns `ctx.events.streams`. Every new
channel costs one `SUBSCRIBABLE_CHANNELS` entry and one sentence, which is the brake on growth working
as intended.

**What is not an event.** Refused by name so the argument is had once. *File opened or saved*: a plugin
that wants this wants a file watcher its node half can run; the post-save invalidation ping is not an
event. *Terminal output and every other owned stream*: PTY, docker logs and stats, the agent token
stream; the lifecycle reduction is the event, the stream stays with its owner. *Anything per-keystroke,
per-selection, per-render, or per-agent-step*. *Machine-scale invalidation mechanics*: a cache talking
to itself (docker's health-check ping, github's 304 bumps, per-step workflow writes); the event is the
completed sync or the terminal state, emitted after the funnel, never inside the loop. *Generic process
and port lifecycle*: a port manager can poll `lsof`; declared run targets changing state is the carve-out
and is an event. *Raw user activity*: an idle or active signal is the most surveillance-shaped thing a
third-party surface could carry; core keeps its own activity record and exposes a projection. *Request
and query payloads*: http's request-sent and database's query-ran are the user's private data and can
carry resolved secrets; the plugin-local record is the feature. *Compose up and down*: another plugin can
ask `docker compose ps`; `task-teardown` made the cut instead because it is archive-coupled state.

**Where a key lives.** With whichever side would otherwise have to import the other. On the node that is
almost always the provider, and the registry says so: "the signature lives in the provider's
`contract/`, never here". `WORKFLOW_CONTROL` is the exception that fixes the rule's wording — agents
declares it, workflows provides it, and the id string still names the provider — because agents draws
the control and workflows already imports agents. Cycle-breaking wins over provider-ownership. Put the
key wherever it does not recreate the import you were avoiding, and say which in its own file.

Like the Node's registry, it is not a DI container: it resolves nothing on its own, constructs
nothing, and orders nothing. Call sites must resolve at call time, never at module scope or in a
component body that runs once, because a plugin's client registration order is not a contract, and
reading a capability during another plugin's init could cache `undefined` just because that plugin
happened to register second. Unlike the Node's registry, which is per-runtime because the service can
boot twice in one process, this one is a module singleton: a renderer has exactly one client graph,
and `_resetClientCapabilities` exists only for tests.

The architecture test enforces zero non-contract plugin-to-plugin edges, no app imports from packages
or plugins, no shell bindings outside `apps/desktop/src/shell`, protocol purity, declared
dependencies, an acyclic package graph, and the client/Node split.

## Data ownership

Table-owning plugins get one `plugins/<name>.sqlite` file under the Node data root and own its
migrations. There are eight: agents, changes, database, GitHub, HTTP, memory, terminal, and workflows.
Core owns shared workspace/task/integration/external-item/security tables. Docker, editor, Linear,
Rollbar, model providers, preview, notes and the built-in agents profiles use core services, provider
registries or plain files without owning a database (notes writes markdown under `<data-root>/notes`).

Both tiers get their handle from `ctx.storage.open()`, and the host owns the lifecycle either way: it
opens the file lazily on the first call, applies the chain, returns the same handle to every later call
in that boot, and closes it immediately after that plugin's `dispose()` — inside the `plugins` step of
`NODE_DRAIN_ORDER`, before core's SQLite and before the data-root lock. A plugin's `dispose` is for what
the plugin itself opened (timers, children, pools, capability slots); GitHub and HTTP need none at all.

What each tier declares:

- **A compiled plugin** sets `migrationsModule: import.meta.url` on its `NodePlugin`. The host walks
  from that module for the chain, which is how one declaration covers all three runtime layouts —
  `plugins/<id>/migrations/` in a source tree, `out/migrations/<id>/` in a build, `<resources>/migrations/<id>/`
  when packaged (`packages/node-core/src/server/plugins/migrations.ts`).
- **A loaded plugin** declares a package-relative `migrations` directory in `acorn-plugin.json`. The
  loader confines and validates that chain and the host binds the filename to the manifest id. A
  `migrationsModule` on a loaded plugin's exported object is IGNORED — a bundle must not be able to point
  the migrator outside its own package.

No declaration means no storage: `ctx.storage` is absent, and reaching for it is an immediate
"not a function". There is no fallback search, and a plugin never names the file, the data root, or the
directory its chain lives in.

HTTP is the only plugin on that path, and it is what makes the rest of this paragraph real rather than
designed: `build-plugin.mjs` stages the declared directory into the package it builds — a chain that
travels with the code, since Drizzle reads the journal and the `.sql` files off disk at migrate time —
and `apps/node/test/integration/plugins/httpLoaded.test.ts` covers a schema change arriving through an
installer update against a populated database, a broken chain failing contained, and
uninstall-without-purge keeping the file. Because the filename is bound from the manifest id, that id
is the one thing in a table-owning package that can never change: renaming it orphans real rows.

There are no cross-file foreign keys, `ATTACH` queries, or transactions spanning plugin databases.
Cross-plugin workflows use durable operation state and explicit IDs/capabilities.

### Uninstalling, and what "purged" means

Uninstall removes the package directory and its lockfile. With `purgeData`, it also removes the
plugin's own SQLite file and its WAL sidecars, and then everything in the core database that is keyed
by the plugin id: the `plugin:<id>:*` prefs rows, and the `schedule_state` and `schedule_runs` rows
under `<id>:`. That last part is `cascadeDeletePluginData`
(`packages/node-core/src/server/db/cascade.ts`); disk goes first and the database second, because a
failure in that order still leaves the plugin gone, where the reverse leaves a running plugin whose
state was deleted underneath it.

The prefs rows are why this exists. Every sandboxed frame's state lives under `plugin:<id>:*`, nothing
could enumerate or delete that namespace, and uninstall audited `dataPurged: true` over rows that were
still there — so a reinstall inherited the old plugin's state with no way for anyone to look at it
first.

Two things a purge deliberately does not reach, and the audit row is still honest about both. A pane id
sits inside a core-owned layout blob (`core:task-layouts`), and the layout normaliser already drops an
id no registered pane answers to. Cached external items belong to the owner's *connection*, not to the
plugin that reads it, and disconnecting the connection is what clears them.

Without `purgeData` nothing is deleted, which mirrors what disabling has always done: reinstalling
finds its data where it left it.

## Tool projection

A plugin registers schema-validated agent tools with risk metadata. Core projects the registry into:

- the task-scoped HTTP tool surface;
- the stdio MCP server used by spawned agents;
- renderer permission and tool-description UI.

The caller's internal-token scope and the owner's tool permission settings are both applied. Tool
implementations run in the Node and use CoreServices; the renderer and MCP process do not open plugin
databases directly.

## Adding a plugin contribution

Every kind that exists, with its tier and where it is declared, is one table in
[contribution-kinds.md](./contribution-kinds.md). Read that first: the odds are good that a kind
already draws what you want.

1. Put the behavior in the owning plugin and choose the correct runtime directory.
2. Use CoreServices rather than importing core implementation modules or another plugin's internals.
   If it needs tables of its own, declare the chain (§ Data ownership) — do not open a database.
3. Add a narrow `contract/` export, capability, or client registry entry when collaboration is
   needed; `ctx.events` if the renderer needs telling.
4. Register the Node/client entry in the appropriate composition list (named below).
5. Add package-local tests and, for rendered behavior, desktop e2e coverage.
6. Regenerate the golden lists (below) and read the diff before you commit it.
7. Run the architecture test, `pnpm lint`, and the relevant tests.

### The files a contribution touches

None of this is discoverable from a stack trace, so it is written down here rather than met as red CI. A
contribution INSIDE an existing compiled plugin — a pane, a rail source, a route, a tool, a settings page —
touches that plugin's own `src/` and then only the golden lists. A whole new compiled plugin also touches:

- `plugins/<id>/package.json`, plus the three one-line config files (§ Package shape). Nothing lists the
  plugin anywhere: `scripts/db.mjs` finds `drizzle.config.ts` by scanning, and `pnpm lint`/`pnpm test` reach
  the package through the workspace.
- `apps/node/src/composition/plugins.ts` — the Node activation list. A plugin that is not in it does not exist in
  that Node. If it needs an adapter only the composition root can build, `NodePluginDeps` grows a key here
  and the adapter itself goes in `apps/node/src/composition/pluginDeps.ts`, which builds the bag once for both
  composition roots.
- `apps/desktop/src/client/plugins.ts` — the client activation list. Rail and pane ORDER is a declared
  field on the contribution, not a position in this array.
- `apps/node/package.json` and `apps/desktop/package.json` — each needs `"@acorn/plugin-<id>": "workspace:*"`
  for the half it composes, the Node one for `node/`, the desktop one for `client/`. A plugin with only one
  half needs only that one entry.

A LOADED plugin instead needs one row in `BUNDLED_PLUGINS` in `apps/desktop/scripts/build-bundled-plugins.mjs`
and its own `acorn-plugin.config.mjs`, and touches no composition list and no golden list: the manifest is
the record, validated at parse time, and it carries the panes, sources, order and chords the compiled lists
would otherwise hold. (Several loaded packages do have an `apps/node` dependency entry, but only because that
app's own tests import them directly — nothing composes them.) Stylesheets are central in neither tier — a plugin's CSS sits next to its component
and is imported by it, and `tools/arch/boundaries.test.ts` enforces that no plugin reaches into another's.

### The golden lists

Four test files hold an exact, reviewed record of what each COMPILED plugin claims. They are snapshots, not
hand-edited tables, and one command rewrites all four:

```sh
UPDATE_PLUGIN_GOLDENS=1 pnpm --filter @acorn/desktop --filter @acorn/node test
```

- `apps/desktop/test/client/parity.snapshot.json` — every compiled pane with its order and chord, and every
  rail source with its order (`parity.test.ts`).
- `apps/desktop/test/client/clientPluginDisable.snapshot.json` — every client registry entry, and which
  optional plugin owns each one (`clientPluginDisable.test.ts`).
- `apps/node/test/integration/routeRegistry.snapshot.json` — every `/v2/p/<plugin>/…` route the compiled
  plugins mount (`routeRegistry.test.ts`).
- `apps/node/test/integration/pluginSystem/pluginDisable.snapshot.json` — the full Node boot's routes, tools, context
  sections, providers and databases, and which optional plugin owns each (`pluginDisable.test.ts`).

Every assertion is exact equality against the file, never a subset, so a contribution that silently VANISHES
fails as loudly as one that appears. That is also what makes the diff the point: regenerating is a deliberate
act, and the snapshot diff is the only place a reviewer sees what a plugin now claims — a disable that took a
sibling's entry with it shows up there as that entry sitting in the wrong plugin's slice. Regenerate in its
own commit hunk and say why the list moved.

Three things in those files stay hand-written, and should keep costing a deliberate edit: the `required` list
in `pluginDisable.test.ts` (`agents`, `memory`, `notes`, `terminal`), because which plugins may not be turned
off is policy and deriving it from `p.required` would assert nothing; the anti-vacuity floors, which are what
stops an exact match against an empty snapshot passing; and the prose above each snapshot read, explaining
what is ABSENT and why, which a generated file cannot say for itself.

`pluginDisable.test.ts` compares route, tool, section, provider and database lists with multiset
subtraction, not set subtraction: it removes each expected entry once and reports what is left over.
A plain `filter` against the expected list would be wrong, because some plugins register several
entries under the same key (github mounts eleven routers under `github/repos`; `changes` and `editor`
each mount two under one prefix). Set-style subtraction would drop all of them for one expectation and
would not notice most of them going missing. Counting catches a duplicate disappearing, which is the
only way an exact match means anything for a key with repeats.

Regeneration can only record what a boot lost, so it cannot record an entry a disable wrongly added;
that case still has to fail the equality against the recorded file. Route removals are also attributed,
not just counted: a route's key names its owning plugin (`/v2/p/<plugin>/...`, see § Activation), so an
entry credited to the wrong plugin in the golden file fails that check even when the overall equality
still passes. Regenerating the file cannot launder a wrong attribution, only a human correcting it can.

Two neighbours have the same shape and different commands. `packages/plugin-api/src/surface.snapshot.txt`
pins the facade's exports and regenerates with `UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`; a
contribution touches it only if it needs a new export from `@acorn/plugin-api`. The exact-set baselines in
`tools/arch/boundaries.test.ts` are ratchets rather than snapshots — they may only shrink, and no flag
rewrites them.
