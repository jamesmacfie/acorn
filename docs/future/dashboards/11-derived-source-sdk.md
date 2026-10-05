# Phase 11: the derived source SDK and scaffold

Status: shipped, October 5, 2026. [What shipped](#what-shipped) records the choices made while
building it. Depends on [phase 8](./08-source-inputs.md). Read the
[programme README](./README.md) first. The
[Derived Sources](https://claude.ai/artifact/W8vHKDojobsSD4GYi5xPxK) page shows the scaffold, the
manifest, the code, and the test in "Building one".

## Goal

A plugin author writes only their logic. The published SDK answers the source operations from
declared fields, checks every record, hands the logic a typed handle per input, and pages through
inputs for it. A test runs the logic against realistic input records without the app. A scaffold
and an agent prompt produce a working package in one step.

## Starting point

- `create-acorn-plugin` (`packages/create-acorn-plugin/index.mjs`) writes `acorn-plugin.json`,
  `node/index.js`, `server/routes.js`, `client.js`, and a README with `apiVersion` 3. It has no data
  source template.
- `acorn-plugin-types` (`packages/plugin-types`) is types only: `contracts/data.ts` and the
  `ctx.dataSources` types in `contracts/context.ts`.
- `acorn-plugin-sdk` (`packages/plugin-sdk`) exports client helpers for frames and remote trees, as
  `.` and `./remote`.
- `@acorn/plugin-api` is private. Its `./node` export carries `selectDataRecords`,
  `dataComparisons`, and `createDataSelectionPager` (`packages/node-core/src/server/dataSources/selection.ts`),
  and its `./testkit` export carries `makeTestNodeContext`. `docs/plugin-authoring/testing.md` says a
  hand-written package can't import the testkit.
- A source handler today receives each operation as a JSON `POST` to its route and must answer all
  six: `describe`, `identity`, `options`, `query`, `details`, and `actions`.
  `plugins/github/src/server/data/branchSourceHandler.ts` shows the plumbing a derived source needs
  without help.
- **Settings › Plugins** has **Create a plugin** with **Ask an agent**, which drafts
  `PLUGIN_STARTER_PROMPT` from `PluginsSettings.tsx` into the open task's composer.

## Requirements

### `acorn-plugin-sdk/data`

1. Add a `./data` export to `acorn-plugin-sdk` with `defineDerivedSource` and field builders. It runs
   in the plugin's node half and has no dependency on client code.
2. Field builders (`field.text`, `field.number`, `field.boolean`, `field.datetime`, `field.choice`,
   `field.person`, `field.link`) produce the `DataField` entries and the JSON schema together, so the
   two can't disagree. They take `label`, `role`, `unit`, `precision`, `list`, and for a choice,
   `choices` with `tone` and `rank`.
3. `defineDerivedSource({ fields, parameters?, starterPlans?, query })` returns the handler the
   manifest's `handler` route serves. It answers:
   - `describe` from `fields` and `parameters`, with a revision derived from a hash of both, which the
     host then composes with input revisions (phase 8).
   - `options` for choice fields with static values.
   - `query` by calling the author's `query({ inputs, parameters, identity, evaluationTime, signal })`.
   - `details` from the last query's records, by id.
   - `identity` as unsupported, and `actions` as an empty list.
4. Each input handle in `inputs` offers `describe()`, `identity()`, `query(query)`, and `all(query)`.
   `all` pages until the input is exhausted or the request's record budget is reached, then returns
   the records with the input's completeness. `where` accepts a plain object of field equality tests
   and converts it to a `DataPredicate`.
5. The author returns `{ id, data, opens? }` records. `opens` is an input record's `ref`. The SDK
   sets the record's `action` or `target` so pressing the row opens the upstream record, using
   only verbs the host already accepts.
6. Before returning a page, the SDK validates each record against the declared schema and drops the
   ones that fail, with the same count and cause the host uses (phase 8). That way an author sees
   the same result in tests as in the app.
7. Optional inputs the person skipped appear as `undefined` in `inputs`, typed that way, so the
   compiler forces the author to handle them.
8. A manifest helper, `derivedSourceManifest(definition)`, emits the `contributions.dataSources`
   entry including `inputs`, so the manifest and code can't disagree. The scaffold uses it in a build
   step.

### `acorn-plugin-sdk/testing`

9. Add a `./testing` export with `testDerivedSource(definition, inputs, options?)`. It runs `query`
   with fake input handles, applies the same record checks, and returns the rows plus any dropped
   records with their reasons.
10. `fixtures('<pluginId>:<sourceId>', partialRecords)` builds input records from the real field list
    of a built-in or first-party source, filling unspecified fields with typed defaults. A field the
    source doesn't have is a test failure with "GitHub pull requests have no field `ci_status`. Did
    you mean `ci`?"
11. Generate the field lists for built-in and first-party sources into the SDK at build time from
    their `describe` output, and check them in, so a change to a source's fields shows up as a diff
    in review. Add an arch test that fails when a shipped list is stale.
12. The testing module runs under any test runner. Its examples use Vitest, which the scaffold
    installs.

### The scaffold

13. Add `--data-source` to `create-acorn-plugin`. It asks what one row represents, which sources it
    reads, and which are optional, listing the built-in and first-party sources by `pluginId:sourceId`
    with their names. It writes:
    - `acorn-plugin.json` with `node`, the data source contribution, and its `inputs`.
    - `src/source.ts` with `defineDerivedSource`, one handle per input, and a `query` that returns
      one record per row of the first input.
    - `src/source.test.ts` with one passing test that uses `fixtures` for each input.
    - A `vite` build for the node half, as the existing external example uses, and a README.
14. The generated package passes `npm test` and installs from **Settings › Plugins › Install… › Local
    folder** without edits.

### Asking an agent

15. Under **Create a plugin**, add **Build a data source from your connections** with **Start**. It
    asks two questions in a small dialog: what should one row be, and which data it needs, as a
    multi-select of available sources. Then it drafts a prompt into a new task that names the
    derived source template, the chosen inputs, their field lists, and the testing helpers. Keep the
    prompt text beside `PLUGIN_STARTER_PROMPT`.

## Out of scope

- Publishing to a registry. Distribution is unchanged: GitHub releases, npm, tarballs, and folders.
- An SDK for non-derived sources. The `./data` module may grow one later. This phase serves derived
  sources only.

## Tests

- Unit tests in `packages/plugin-sdk` for each field builder, `describe` output, record validation,
  `all` paging and budget, `opens`, and skipped optional inputs.
- An integration test that serves a `defineDerivedSource` handler from a fixture plugin under the
  phase 8 runtime with `makeTestNodeContext`, and reads it through `invokeDataSource`.
- A scaffold test that generates a package into a temp folder, runs its test, and validates its
  manifest with the node manifest validator.

## Docs to update

- `docs/plugin-authoring/start-from-the-scaffold.md`: the `--data-source` template.
- `docs/plugin-authoring/testing.md`: `acorn-plugin-sdk/testing` for hand-written packages.
- `docs/plugin-authoring/the-node-half.md`: `defineDerivedSource`.
- A new page named derived-sources.md in `docs/plugin-authoring`, that walks through the Release readiness
  example end to end. Add it to `docs/README.md`.

## Verify before building

- How `acorn-plugin-sdk` is built and published today, and whether adding node-side exports changes
  its runtime requirements for client-only plugins. If it does, publish `./data` and `./testing` as a
  separate package instead.
- The external example at `~/Source/acorn-machine-stats` builds its node half with Vite and inlines
  dependencies. Confirm the SDK inlines cleanly the same way.

## What shipped

Requirements 1 to 15 shipped, with the departures below.
[Derived sources](../../plugin-authoring/derived-sources.md) describes the shipped behaviour and wins
over this page.

Where the code lives:

- `packages/plugin-sdk/src/data/derived.ts` is the handler, the field builders, the input handles, and
  the record check. `src/testing/index.ts` is `testDerivedSource` and `fixtures`. Each entry's
  declaration is a hand-written `public.ts` copied to `dist`, as the frame entries' are, and the
  `derived.test.ts` and `testing.test.ts` beside them hold the two together.
- `src/testing/sourceFields.json` is the field lists. `tools/arch/sourceFields.test.ts` writes it
  from each source's description and fails when it's stale.
- `src/data/runtime.test.ts` is the integration test. It serves a `defineDerivedSource` handler from
  a `makeTestNodeContext` plugin and reads it through `invokeDataSource`.
- The template is `dataSourceFiles` in `packages/create-acorn-plugin/index.mjs`. The settings dialog
  is `DataSourcePromptDialog.tsx`, and its prompt is `dataSourceStarterPrompt` beside
  `PLUGIN_STARTER_PROMPT` in `PluginsSettings.tsx`.

Choices made while building it:

- `./data` and `./testing` stay in `acorn-plugin-sdk`. They're separate entries that share no module
  with `.` or `./remote`, so a frame-only plugin's bundle never carries them. They inline the host's
  validator from `@acorn/protocol`, which imports nothing, and the built files carry no Zod. The
  package gained `acorn-plugin-types` as a dependency, for the declarations only, and moved to 1.1.0.
  They compile under their own `tsconfig.node.json`, because the frame entries may assume only the DOM.
- The Vite build the external example uses inlines the SDK cleanly. The scaffold test bundles a
  generated package against the packed SDK and checks that `dist/node.js` imports no package.
- `defineDerivedSource` returns `{ definition, description, fetch }` rather than a bare handler, so
  `derivedSourceManifest` and `testDerivedSource` take the same value the node entry serves. The
  definition carries the descriptor and `handler` too, because the manifest entry needs them.
- `query` gets `inputs`, `parameters`, `evaluationTime`, `mode`, and `signal`, but no `identity`.
  Each input handle has `identity()`, which is the account a read uses.
- `options` isn't answered. The host serves static choices from the description and calls `options`
  only for dynamic choices, which the builders don't make. `identity` is unsupported and `actions` is
  empty, as planned, and the host never dispatches either for this description.
- The fields advertise no filter operators, so a panel's filter steps run on the Node after the
  source answers. The SDK runs the logic once per query and pages its result, keeping 16 selections
  for a minute, as `createDataSelectionPager` does.
- `all` stops at 5,000 records, the host's cap on one query, and marks the page `incomplete` with
  `host-budget`. A record the SDK drops is counted as `invalid-records`. A shared id still fails the
  query, as it does in the host.
- `opens` copies the upstream record's `openUrl` or `openTask` action. A `target` can't be copied,
  because the host accepts only targets in the plugin's own namespace.
- Field builders take `nullable` as well, because a derived row often has no value for a field, such
  as an issue with no pull request.
- The scaffold writes the manifest entry itself, so an unbuilt package is valid. `npm run build`
  rewrites it from `derivedSourceManifest` by importing the built `dist/node.js`, which exports
  `source` beside its default export.
- **Build a data source from your connections** drafts into the open task's agent, as **Ask an agent**
  does, rather than into a new task. Settings has no project in scope, and `TaskSeed` has no prompt
  field (`docs/plugins/agent-install.md`). The prompt names each input by id and has the agent read
  its fields with `data_source_describe`, because Settings can't describe a provider source without
  an account. The `plugin_authoring` brief gained a section on derived sources for the prompt to
  point at.
