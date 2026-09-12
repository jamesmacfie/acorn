# Package shape

[Back to plugins](../plugins.md)

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
[conventions.md](../conventions.md).

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
| `@acorn/plugin-api/ui` | Frame-safe presentation components: primitives (including the `ListDetail` two-column pane layout), `Icon`, `Picker` and its `PickerRow` for a list that opens from typing rather than from a button, `Menu` and its `RowActions` wrapper for the ellipsis menu on a list row, `Modal`, `Tabs`, `Markdown`, the diff rows, and `DiffPane` for the whole diff viewer. Also `attachPty`, which fills a `pty` rectangle from the channel the caller describes rather than from a box the host hands back ([terminal.md § Client](../terminal.md)) |
| `@acorn/plugin-api/ui/diff` | The diff model, virtualizer, hydration and find pass, plus the `DiffSource` port `DiffPane` is driven through |
| `@acorn/plugin-api/ui/host` | Compiled-shell-only connected components and registration seams; never import this from an isolated frame |
| `@acorn/plugin-api/ui/editor` | The host-owned CodeMirror surface: the theme, the view-state pair, and `languageForPath`, which is async because it downloads one grammar. Compiled panes only. The terminal client aliases it to a stub, because cells have no highlighter ([tui.md](../tui.md) § The host switch) |
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
capability (`notice` came back on 2026-09-10 with a `target` in place of workflows' `runId` pair, which
is what the objection had actually been about — adding a name is free, so no bump), a loaded plugin's capability ids became bound to its own namespace, and its pane, source and
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
([command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md)). `ctx.paletteRows` went with
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
  [contribution-kinds.md](../contribution-kinds.md) says why, kind by kind, and what would have to be
  true for one to move.

`packages/client-core/src/host/registries/extensionPoints/plugin.ts` splits the client's the same way,
into `ClientPluginContext` and `CompiledClientPluginContext`, though there the split is for honesty
rather than for a caller: a loaded plugin's client half is a manifest plus a tree or a frame and is never
handed the object at all.

This was one type with per-member comments until 2026-08-31, and the comments were the only thing saying
which tier got what. Reaching for a compiled-only member from a loaded plugin compiled fine and failed at
run time as "not a function", which is a bad way to learn a rule. It is a `tsc` error now.

Two members are on both tiers and gated by neither: `ctx.telemetry` and `ctx.log`. They are also
the two the host's revocation pass deliberately skips, so a context left over from a reload keeps
logging under its own name rather than throwing. A logger that throws would break the one rule
telemetry has, which is that it never fails the thing it describes
([telemetry.md](../telemetry.md) § Never fail what you measure). Reading the stream is the separate
`telemetry` facet on `ctx.core`, and that one is a token.

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
node-core and client-core — Hono, Drizzle, Solid, CodeMirror — and a plugin does not want a second copy of
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
to order init ([plugin authoring](../plugin-authoring.md) § Requiring another plugin). It exists because
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

The field-by-field reference is [plugin authoring](../plugin-authoring.md) § The manifest, and it is
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

`makeTestNodeContext({ plugin, permissions?, migrations?, userId? })` is therefore not a mock. It calls the
same `server/pluginHost/context.ts` the host calls at boot, over a temp data root, so which tier a test
gets — `routes.register` present or absent, core scoped or whole, storage bound or missing — is the
host's decision and not the test's. Its `cleanup()` runs the host's own registration rollback.
`userId` binds the machine identity, because a context built with nothing seeded has had no boot to
mint one and `ctx.core.identity.active()` answers null without it. Pass it where the plugin reads
the owner off `ctx` rather than off a request: an agent tool, a workflow step, a telemetry sink.
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
