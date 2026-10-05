# Published packages

This page covers the three npm packages that leave this repository, the compatibility promise behind
them, and what the host does with a manifest's version fields. Read it before you change a published
name or signature. It's part of the [plugin reference](../plugins.md).

## What is published

Three unscoped packages are published. They're unscoped because `@acorn/*` would need an npm
organization that doesn't exist.

| Package | What it is |
| --- | --- |
| `create-acorn-plugin` | The scaffold, in `packages/create-acorn-plugin`. It emits the no-bundler profile and depends on nothing |
| `acorn-plugin-sdk` | The sandbox bridge, in `packages/plugin-sdk`: `connect`, `mountFrame`, `mountTree`, `openLinkOnClick`, `AcornBridgeError`, and the `AcornBridge` type. Its `/remote` subpath carries the tree nodes and Solid adapter. Its `/data` and `/testing` subpaths are for a node half: `defineDerivedSource` and the field builders, then `testDerivedSource` and `fixtures` ([derived sources](../plugin-authoring/derived-sources.md)) |
| `acorn-plugin-types` | The node-side API as declarations, in `packages/plugin-types`, plus the generated manifest schema. No runtime, and `@types/node` is its only peer |

Only the bridge and the declarations are published. The private facade re-exports node-core and
client-core, with Hono, Drizzle, Solid, and CodeMirror behind them, and a plugin doesn't want a
second copy of any of those. It uses the host's through `ctx` and through the document its frame is
served in. The bridge is the one thing an outside author can't get any other way. The derived source helpers
are the exception on the node side: they inline the host's record validator, so a record the SDK
keeps is one the host keeps, and they depend on nothing but `acorn-plugin-types` for their
declarations. A test imports
the SDK in a bare Node environment, so a re-exported component fails here and not in a stranger's
bundler.

## The compatibility promise

The loaded-plugin promise covers the published SDK, the published declarations, and the manifest and
runtime contract. A plugin tested against a supported major can declare it in its `apiVersion`
range. A breaking removal or shape change needs a new major. Changes to the private facade alone
don't. The npm package versions are independent of `PLUGIN_API_MAJOR`, which is `3`
(`packages/protocol/src/plugin/apiVersion.ts`).

A manifest's `apiVersion` is a range over majors: `"3"`, `"2 || 3"`, or an inclusive span such as
`"2-4"`. `speaksApiVersion` implements the comparison, and an invalid range is rejected, not treated
as a match. The installer, both Node loader paths, and client bundle selection check it. A breaking
change to the loaded contract needs a bump, then a rebuild of loaded packages and the bundled
plugin set. A range doesn't make an untested older major compatible, and it doesn't set a
deprecation period.

`requires.plugins` uses the same grammar for a different question. `apiVersion` says which acorn a
package speaks, and `requires` says which other packages it needs on the Node. The loader checks it
at load and uses it to order init ([requiring another plugin](../plugin-authoring/the-manifest.md#requiring-another-plugin)).

The majors 2 through 13 in older history described a wider compiled facade before the `acorn-1`
reset. The reset began at major 1. Major 2 changed the diff source port to a topology, segments,
and search.

## How the published surface is guarded

Three checks hold the published names to the host:

- `tools/arch/publishedPluginSurface.snapshot.txt` pins the published names and declared members of
  `acorn-plugin-sdk` and its `/remote`, `/data`, and `/testing` subpaths, and `acorn-plugin-types`. Regenerate it with
  `UPDATE_PUBLISHED_PLUGIN_SURFACE=1 pnpm --filter @acorn/arch-tests test`. The regeneration refuses
  removals while `PLUGIN_API_MAJOR` stays the same. The test also compares SDK runtime exports with
  the hand-written declarations.
- `packages/plugin-sdk/src/contract.test.ts`, and the `derived.test.ts` and `testing.test.ts` beside
  `/data` and `/testing`, hold the SDK's declarations to the implementation with assignability checks
  in both directions, so `tsc --noEmit` fails when an upstream shape moves under
  a stable name.
- `packages/plugin-types/src/contract.test.ts` does the same for the node context and core facets,
  member for member.

Review a signature change as a compatibility change even when every name stays.

`packages/plugin-sdk/src/public.ts` is the SDK declaration, hand-written and copied to
`dist/sdk.d.ts`. `packages/plugin-types/src/public.ts` is the root of `acorn-plugin-types`, and it
re-exports the contract types under `src/contracts/`. A declaration-only build emits `dist/index.d.ts`.
Hand-written declarations avoid a declaration rollup, and a person wrote and reviewed each one.

`acorn-plugin-types` describes the loaded tier, so `routes.register`, `events.channel`, and
`events.streams` are absent. A few members carry a type declared as `HostOwned<…>` instead of a
description, such as the drizzle handle behind `ctx.storage.open()`. Describing them would add the
dependency the package promises not to have. `contract.test.ts` names each one and asserts the count,
which is six, so the list grows only on purpose.

A plugin picks the types up with a JSDoc annotation and no build step:

```js
/** @param {import('acorn-plugin-types').NodePluginContext} ctx */
init(ctx) { … }
```

## The manifest schema

[The manifest](../plugin-authoring/the-manifest.md) is the field-by-field reference. This section is
what the host does with the file.

The host reads these top-level keys:

- `id` names the route prefix, the directory under `<dataRoot>/plugins/`, and the SQLite file.
- `name` is display text. It goes out as `label` on the roster row.
- `version` is what the installer's downgrade guard compares.
- `baseline` must be `"acorn-1"`.
- `apiVersion` is checked at load, at install, and at client bundle selection.
- `node`, `client`, and `migrations` are relative paths, confined inside the package directory both
  lexically and through symbolic links.
- `requires` orders init and refuses a package whose dependency is absent.
- `emits` names the event verbs other plugins may subscribe to.
- `permissions` and `contributions` are what the trust dialog renders and the registries read.
- `icon` and `icons` register brand marks, and `$schema` is ignored.

The schema strips any other key and the roster reports it, so a manifest written for a newer acorn
loads on an older one and contributes less ([forward compatibility](./forward-compatibility.md)).

`packages/plugin-types/acorn-plugin.schema.json` is the JSON Schema for `acorn-plugin.json`,
generated from `packages/protocol/src/plugin/contract.ts`. `pluginSchema.test.ts` regenerates it and
fails when the committed bytes differ. Regenerate it with `UPDATE_PLUGIN_SCHEMA=1 pnpm test`. The
scaffold writes the `$schema` key, so a scaffolded plugin gets completion and inline errors from its
first line.

`PLUGIN_BRIDGE_VERSION` in `packages/protocol/src/plugin/bridge.ts` isn't published. `connect()`
compares it and refuses a hello it doesn't recognize. Exporting it would invite a plugin to branch on
it and claim two protocol versions, which acorn doesn't promise.
