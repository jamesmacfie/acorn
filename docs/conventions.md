# Conventions: how things are named, stated once

This is the naming rulebook for the repo. It exists so a reader can guess where a file lives and what
it holds without opening it, and so a reviewer has something to point at instead of a preference.

Most of these rules already hold everywhere. Where the tree does not match, the rule is still the
rule and a **Not yet everywhere** line names the exception. The reorganisation that produced this
file closed most of them on 2026-08-30; what is left below is what it did not reach. Clear one and
delete its line.

A few of these rules are held by a test rather than by review. [What a test enforces](#what-a-test-enforces)
at the end says which, and why the rest are not worth automating.

## Files

**A PascalCase `.tsx` file exports a Solid component. A camelCase `.ts` file is a module.** No
PascalCase `.ts` file exists anywhere. A camelCase `.tsx` is allowed when a module that is not a
component needs JSX: a registry holding a fallback, an entry file. Do not reach for `.tsx` on a file
with no JSX in it.

**Tests are `<subject>.test.ts` or `.test.tsx`, beside the subject.** Every test in the repo is
colocated; there is no `.spec` and no `__tests__/`. The extension picks the runner, because `.tsx`
runs in jsdom, so one subject may have both. There is no other infix. A test named for a behaviour
rather than a module is fine, and it lives in the folder of the module it exercises most; it never
sits in a different folder from its subject.

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
not a re-export list.** This holds in the plugins, where barrels exist only at the documented
subpaths, and nearly holds in client-core, which has two barrels across 516 files.

One exception stays: two plugin entrypoints are really vendor clients
(`plugins/linear/src/server/index.ts`, `plugins/rollbar/src/server/index.ts`). They keep the name for
the `vi.mock` constraint the arch test records. github's became `server/githubApi.ts`.

**A published entrypoint is a bare file, not a folder holding one file.**

Not yet everywhere: `packages/plugin-api` spells it both ways. `./ui` is `src/ui/index.ts` and
`./testkit/client` is a file in a folder, while the other entrypoints are bare files.

## Solid and state

**`create*` is a Solid reactive factory: it returns signals, a store, or something disposable.** A
plain function that builds a value is named for the value or for the verb, not `create*`. `createTask`
and `createProject` keep the prefix because they really do create the resource, and the query layer's
matched `*Options` and `*Key` pair sits beside them. There is no `use*` prefix in this codebase.

Two renames landed on 2026-08-30: `createTaskPath` became `newTaskPath`, because it builds the
`/new` route rather than a task, and `workspaces/useActiveWorkspaceId.ts` became
`activeWorkspaceId.ts` exporting `createActiveWorkspaceId`, a Solid primitive that reads the router.

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
slots, sources, drawers, rail markers, references, collections, and agent context. `extensionPoints.ts`
means a plugin's cooperative extension-point table and nothing else; do not use it for a contribution.

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
reads it as one of these seven; an eighth name is refused by none of them and stops being governed.

**No folder is named `main`, `service`, or `wiring`**, at any depth. `main/` meant "the Electron main
process", and once Electron went it was arbitrary which of `main/` or `server/` a module landed in. The
arch test keeps the words retired.

Renaming `packages/node-core/src/server/` to `domain/` was refused on 2026-08-30. The folder is the
whole node library rather than an HTTP server, so `server/` understates it, but `server/` is the name
every plugin uses for the same side, and one word for one side across 20 packages is worth more than
a truer word in one.

**A folder is plural for a collection of peers and singular for a layer.** `routes/`, `plugins/`,
`registries/`, and `features/` are collections. `server/`, `client/`, `kit/`, and `host/` are layers.

**A folder does not repeat its own name in its files.** `pluginHost/pluginState.ts` is
`pluginHost/state.ts`. A module that moves into a folder named for its subject drops the prefix.

**A registry is `registry.ts` inside the folder of the thing it registers.** This already holds seven
times in node-core.

Not yet everywhere: `packages/node-core/src/server/routeRegistry.ts` and
`packages/node-core/src/server/integrations/connectionRegistry.ts` still carry the prefix. Either the
file conforms or its folder does.

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

Five of the rules above are checked by `tools/arch/boundaries.test.ts`, which
`.github/workflows/ci.yml` runs on every pull request: the seven folder names, the contents of `node/`,
no test under a `contract/`, no folder named `main`, `service`, or `wiring`, and the package
description. `tools/arch/docPaths.test.ts` covers the citations, in this file and every other doc: a
repo-rooted path in backticks has to resolve, a relative link between docs has to resolve, and a
retired directory name may appear only on a line that marks it gone.

The rest are review rules on purpose. A naming convention is a prompt for the reader, and a test that
matches filenames against a pattern has to carry an exception list for every deliberate case — the two
vendor clients that keep `server/index.ts` for a `vi.mock`, the `createTask` that really does create a
resource, the `model.ts` that holds no state. That list is the thing people learn to append to instead
of reading. The rules a test does hold are the ones where a wrong name silently turns another rule off.
