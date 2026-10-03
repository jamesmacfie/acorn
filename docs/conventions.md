# Conventions: how things are named, stated once

This page says where a file goes and what to call it. Read it before you add a file, a folder, or a
package. Architecture tests enforce the rules listed in [What a test enforces](#what-a-test-enforces).
Each "Not yet everywhere" note names the files that don't follow a rule yet.

Documentation follows the same idea. A long reference splits into a topic subfolder, keeps a landing
page at its old path, and lists every page in [Documentation](./README.md).
[Package boundaries](./architecture/packages.md) covers what a package may import.

## Files

**A PascalCase `.tsx` file exports a Solid component. A camelCase `.ts` file is a module.** A
camelCase `.tsx` is allowed when a module that isn't a component needs JSX, such as a registry holding
a fallback or an entry file. Don't use `.tsx` for a file with no JSX in it.

Not yet everywhere: `packages/client-core/src/host/plugins/ExclusiveSlotFailure.ts` is a PascalCase
`.ts` file.

**Tests are `<subject>.test.ts` or `.test.tsx`, beside the subject.** Every test in the repo is
colocated. There's no `.spec` and no `__tests__/`. The extension picks the runner, because `.tsx`
runs in jsdom, so one subject may have both. There's no other infix. A test named for a behavior
instead of a module is fine. It lives in the folder of the module it exercises most.

Repository-wide source-shape checks live in `tools/arch/`, because their subject is the package graph
or the whole renderer source. For example, `primitiveAdoption.test.ts` scans client-core, plugins, and
desktop.

Not yet everywhere: `packages/client-core/src/infra/persistence/startupRestore.integration.test.ts`
and `apps/desktop/test/integration/persistedState.conformance.test.ts` still carry an infix. Each
folds into the plain test beside it or takes the behaviour's name.

**Fixtures live in `__fixtures__/`.** A helper that is not itself a test takes a `.helper.ts` suffix
or lives in `test/helpers/`.

**Scripts are kebab-case `.mjs`.** A `.ts` script is camelCase like any other TypeScript module.

**CSS sits with its feature, is kebab-case, and is imported only by files in its own folder.** The
stylesheets more than one feature reads stay together in one `styles/` folder.

Not yet everywhere: two files under `features/settings/nodes/` import `features/fleet/nodes.css`.
Either the stylesheet moves or the importers do.

## Exports and barrels

**`index.ts` exists only where an exports map or a build entry demands it, and it is an entrypoint,
not a re-export list.** Library packages use feature-owned `public.ts` files for named cross-package
exports. Add a binding there only when an external caller needs it. Keep internal imports relative.
A leaf entrypoint in the exports map fits when a host needs one model or adapter and the feature
barrel would load a different renderer. Declare that path in the package exports map and keep it under
the same feature owner. Don't import package internals the map doesn't list.

One exception stays: two plugin entrypoints are really vendor clients
(`plugins/linear/src/server/index.ts`, `plugins/rollbar/src/server/index.ts`). They keep the name for
the `vi.mock` constraint the arch test records. github's became `server/githubApi.ts`.

**A published entrypoint is a bare file, not a folder holding one file.**

Not yet everywhere: `packages/plugin-api` spells it both ways. `./ui` is `src/ui/index.ts`, and
the client testkit entries are files under `src/testkit/`, while other entrypoints are bare files.

## Solid and state

**`create*` is a Solid reactive factory: it returns signals, a store, or something disposable.** A
plain function that builds a value is named for the value or for the verb, not `create*`. `createTask`
and `createProject` keep the prefix because they create the resource, and the query layer's matched
`*Options` and `*Key` pair sits beside them. There's no `use*` prefix in this codebase.

**Client state is `<thing>Store.ts`.** Two spellings survive that on purpose. `*Prefs.ts` is state
persisted as a device preference, which is a different lifetime. `model.ts` is pure data shaping with
no reactive state in it at all.

Not yet everywhere: `*Slice`, `*State`, and `*ViewState` still appear in agents, context, editor,
and notes. Each folds into `*Store`.

**A client HTTP wrapper is `<plugin>Client.ts` in `client/`.** If another package needs the wrapper it
moves to `contract/` and keeps the name.

Two exceptions stay: agents keeps one wrapper per feature folder, and editor keeps
`client/search/searchClient.ts` beside the panel it serves.

## Contributions

**A file that registers one kind of contribution is `<kind>Contribution.ts`.** This holds for panes,
slots, sources, drawers, rail markers, references, data sources, and agent context. `extensionPoints.ts`
means a plugin's cooperative extension-point table and nothing else. Don't use it for a contribution.

## Routes and wire types

**`server/routes/<name>.ts` is a Hono router. Route builders and wire types are `api.ts`.** `api.ts`
lives in `shared/`, unless another package imports it, in which case it lives in `contract/`.

## Folders

**`contract/` holds only what another package imports. `shared/` holds what both halves of this plugin
read.** The arch test enforces the first half and the file headers say it. A test file never sits under
`contract/`, and the arch test refuses one: `./contract/*` is a directory wildcard, so anything under it
is importable from another package, tests included.

**A plugin's `src/` children are drawn from seven names**: `node`, `server`, `client`, `tree`,
`contract`, `shared`, `testkit`. No loose files, and `node/` holds `index.ts` and `schema.ts` and
nothing else. The arch test enforces both, because every rule that keys off the first path segment
reads it as one of these seven. An eighth name would be refused by none of them and stop being
governed.

**No folder is named `main`, `service`, or `wiring`**, at any depth. `main/` meant "the Electron main
process", and once Electron went it was arbitrary which of `main/` or `server/` a module landed in. The
arch test keeps the words retired.

`packages/node-core/src/server/` keeps its name. The folder is the whole Node library, not an HTTP
server, so `server/` understates it. But every plugin uses `server/` for the same side, and one word
for one side across 20 packages is worth more than a truer word in one.

**A folder is plural for a collection of peers and singular for a layer.** `routes/`, `plugins/`,
`registries/`, and `features/` are collections. `server/`, `client/`, `kit/`, and `host/` are layers.

**A folder does not repeat its own name in its files.** `pluginHost/pluginState.ts` is
`pluginHost/state.ts`. A module that moves into a folder named for its subject drops the prefix.

**A registry is `registry.ts` inside the folder of the thing it registers.** Node HTTP routes use
`server/routes/registry.ts`, and connection providers use `server/integrations/connectionProviders/registry.ts`.
The integration provider registry remains separate in `server/integrations/registry.ts`.

**One file is not a folder.** A folder holding one module, with no second one planned, is a file
instead. The exceptions are the folders an exports map or the arch test names by hand: `node/`,
`testkit/`, `platform/`.

**Above twelve direct files, group.** This one is a prompt, not a law: twelve is where a folder stops
being readable at a glance, not a number anything enforces.

## Packages

**Every workspace `package.json` carries a one-line `description`.** A README per package is not
required, because `docs/` owns the prose, which makes that line the only answer `pnpm ls -r` can give
to "what is this". The arch test refuses a package without one.

**A dependency only the tests use is a `devDependency`.**

## What a test enforces

`tools/arch/boundaries.test.ts` checks five of the rules above, and `.github/workflows/ci.yml` runs
it on every pull request:

- The seven folder names.
- The contents of `node/`.
- No test under a `contract/`.
- No folder named `main`, `service`, or `wiring`.
- The package description.

Two more tests check the docs. `tools/arch/docPaths.test.ts` checks that every repository path in
backticks and every relative link between docs resolves, and that a retired directory name appears
only on a line that marks it gone. `tools/arch/docCitations.test.ts` checks that every
`docs/<page>.md § Heading` in a source comment names a doc and a heading that exist.
[Architecture rules](./testing/architecture-rules.md#doc-checks) covers both.

The other rules are review rules on purpose. A naming convention is a prompt for the reader. A test
that matched filenames against a pattern would need an exception for every deliberate case: the two
vendor clients that keep `server/index.ts` for a `vi.mock`, the `createTask` that does create a
resource, and the `model.ts` that holds no state. People learn to add to that list instead of reading
it. The rules a test does hold are the ones where a wrong name turns another rule off without anyone
noticing.
