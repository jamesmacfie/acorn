# Conventions: the naming rules, stated once

Part of [docs/future/structure/](./README.md). Phase 1 moves this text to `docs/conventions.md` (new) as an
owning doc and this file becomes a pointer. Until then it is the draft. Each rule says whether it
already holds (and gets written down) or resolves a split (and phases 2 to 5 apply it).

## Files

**A PascalCase `.tsx` file exports a Solid component. A camelCase `.ts` file is a module.** Holds:
zero PascalCase `.ts` files exist anywhere. A camelCase `.tsx` is allowed when a non-component module
needs JSX (a registry that holds a fallback, an entry file). Do not use `.tsx` for a file with no JSX;
`apps/desktop/src/app/client/pageContributions.tsx` and `slotContributions.tsx` become `.ts` in
phase 2.

**Tests are `<subject>.test.ts` or `.test.tsx`, beside the subject.** Holds: 100% colocated across
the repo, zero `.spec`, zero `__tests__/`. The extension picks the runner (`.tsx` runs in jsdom), so
a subject may have both. Resolves: no other infix. The one `.integration.test.ts` in node-core and
the two `.conformance.test.ts` files fold into the plain test or take the behaviour's name
(`tunnelPortsReuse.test.ts`). A test named for a behaviour rather than a module is fine; it lives in
the folder of the module it exercises most, and never in a different folder from its subject.

**One fixture convention, `__fixtures__/`.** Resolves: agents' `testFixtures/` renames. Non-test
helpers under a `test/` directory take a `.helper.ts` suffix or live in `test/helpers/`.

**Scripts are kebab-case `.mjs`.** Holds in `apps/node/scripts` and four of five in
`apps/desktop/scripts`. Resolves: `nodeRuntime.mjs` and `locate-db.ts` (the one kebab-case `.ts`
beside camelCase siblings) conform to their neighbours.

**CSS is colocated with its feature, kebab-case, and imported only by files in its own folder.**
Resolves: two cross-folder CSS imports in client-core move the stylesheet or the importer. The shared
stylesheets stay in one `styles/` folder.

## Exports and barrels

**`index.ts` exists only where an exports map or a build entry demands it, and it is an entrypoint,
not a re-export list.** Holds in plugins (barrels exist only at the six documented subpaths) and
mostly in client-core (two barrels in 516 files). Resolves: an entrypoint that is really a vendor
client (`plugins/linear/src/server/index.ts`, `plugins/rollbar/src/server/index.ts`,
`plugins/github/src/server/index.ts`) is renamed to what it is (`linearApi.ts`) where the `vi.mock`
constraint allows, and the arch test's two-entry allowlist shrinks if it does.

**A published entrypoint is a bare file, not a single-file folder.** Resolves: `plugin-api` spells it
both ways; phase 5 picks bare files.

## Solid and state

**`create*` is a Solid reactive factory: it returns signals, stores, or a disposable.** Holds for 32
exports. Resolves: a plain function that builds a value is a noun or a verb on the resource.
`createTaskPath` becomes `taskPath`. `createTask` and `createProject` stay; they create the resource,
and the query layer's `*Options` and `*Key` pair (nine pairs, consistent) is the pattern beside them.
No `use*` prefix; `workspaces/useActiveWorkspaceId.ts` renames.

**Client state is `<thing>Store.ts`.** Resolves the five-suffix split (`*Slice`, `*State`,
`*ViewState`, `*Store`, `model.ts`). `*Prefs.ts` is kept for state persisted as a device preference,
because that is a different lifetime. `model.ts` is kept for pure data shaping with no reactive
state in it.

**A client HTTP wrapper is `<plugin>Client.ts` in `client/`.** Resolves: eight spellings today, two of
them in `contract/`. If another plugin needs the wrapper, the wrapper moves to `contract/` and keeps
the name.

## Contributions

**A file that registers one contribution kind is `<kind>Contribution.ts`.** Holds for panes, slots,
sources, drawers, rail markers, references, collections, agent context. Resolves:
`extensionPoints.ts` is reserved for a plugin's cooperative extension-point table and is not used
for a contribution.

## Routes and wire types

**`server/routes/<name>.ts` is a Hono router. Route builders and wire types are `api.ts`.** Resolves
the three meanings of `routes.ts`. `api.ts` lives in `shared/` unless another package imports it, in
which case it lives in `contract/` (below).

## Folders

**`contract/` holds only modules another package imports. `shared/` holds what both halves of this
plugin read.** Already the rule in the arch test and in file headers. Resolves: eight modules move
from `contract/` to `shared/` in phase 4, and a test file never sits under `contract/` (phase 6 adds
the arch rule).

**Plugin `src/` children are drawn from seven names**: `node`, `server`, `client`, `tree`, `contract`,
`shared`, `testkit`. `main/` is retired. `node/` holds `index.ts` and `schema.ts` and nothing else.

**A folder is plural for a collection of peers and singular for a layer.** `routes/`, `plugins/`,
`registries/`, `features/` are plural. `server/`, `client/`, `kit/`, `host/` are singular. Resolves:
`server/plugin/` in node-core becomes `server/pluginHost/`.

**A folder does not repeat its own name in its files.** `pluginHost/pluginState.ts` is
`pluginHost/state.ts`. The ten `plugin*` modules in node-core lose the prefix when they move into a
`plugins/` folder.

**A registry is `registry.ts` inside the folder of the thing it registers.** Holds seven times in
node-core. Resolves: `routeRegistry.ts` and `connectionRegistry.ts` conform or the folder does.

**One file is not a folder.** A folder with one module and no planned second one is flattened to a
file. The exceptions are the folders an exports map or the arch test names (`node/`, `testkit/`,
`platform/`).

**Above twelve direct files, group.** The threshold is a prompt, not a law. `agents/src/client` at 69
and `node-core/src/main` at 78 are past arguing.

## Packages

**Every workspace `package.json` has a one-line `description`.** Resolves: none do. Phase 6 adds
them; a README per package is not required because `docs/` owns the prose.

**A library dependency used only by tests is a `devDependency`.** Resolves: 13 plugins list
`@acorn/node-core` or `@acorn/client-core` as runtime dependencies and import them from zero
production files.
