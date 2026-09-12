# acorn-plugin-types

The node-side plugin API for [acorn](https://github.com/jamesmacfie/acorn), as TypeScript
declarations. No runtime and nothing to bundle. The one thing it assumes is `@types/node`, declared as
an optional peer, because a process result names `NodeJS.Signals` and this is a node-side API.

```sh
npm i -D acorn-plugin-types
```

## Typed `ctx`, with or without TypeScript

An acorn plugin's node half is plain JavaScript in a directory the owner installed, so this works
without a build step. A JSDoc annotation is enough:

```js
export default {
  name: 'my-widget',

  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.routes.fetch(async (request, context) => Response.json({ user: context.userId }))
  },
}
```

In TypeScript, import the types directly:

```ts
import type { NodePlugin, NodePluginContext, TaskRef } from 'acorn-plugin-types'
```

## The manifest schema

The package ships `acorn-plugin.schema.json`, generated from acorn's own manifest contract. Point
your manifest at it and every contribution array is validated as you type:

```json
{
  "$schema": "https://acorn.sh/schemas/acorn-plugin.schema.json",
  "id": "my-widget",
  "name": "My widget",
  "version": "0.1.0",
  "apiVersion": "12"
}
```

## Commands are five shapes, not one

A `commands` entry used to be one thing: a title and a closed verb the host runs. It is a
discriminated union now, and a descriptor with no `kind` still means exactly what it always did, so
nothing already written needs editing.

| `kind` | What it is |
| --- | --- |
| `action` (the default) | One closed verb. |
| `group` | Holds children. Any command may name a `parentId`, which must be a group in the same manifest. |
| `search` | A GET `route` in your own namespace and one static `onSelect` verb. The host debounces the typing, sends the query and the identifier your declared `scope` owns, and draws the rows you answer with. |
| `input` | A POST `route` and one static `onSuccess` verb. Submitted on Enter, never debounced, and your text survives a failure. |
| `setting` | A GET read route, a PUT write route, and 2-32 labelled choices. |

A route's answer never chooses behaviour: it carries display facts and identity, and the verb that
runs is the static one your manifest declared. The schema above has the full shape of each, including
the bounds the host enforces.

## What is here, and what is not

Everything the host hands a loaded plugin: the context and its registries, `ctx.core` and its
facets, `TaskRef` and `ProjectRef`, the request context a route handler receives, and a catalogue of
every capability the first-party plugins publish.

A few context members carry a type this package deliberately does not describe — notably the host's
drizzle handle behind `ctx.storage.open()`. The manifest-carried `PluginAgentToolDescriptor`,
`PluginContextSectionDescriptor`, and bounded `PluginToolJsonSchema` are pure declarations and are
exported here without adding a runtime dependency. The rest of the surface is exact, and a test in
the acorn repository fails if it drifts.

`apiVersion` is a range over plugin API majors. The minimum/current major for agent-tool and context
descriptors is `"12"`; write `"12"`, or `"11 || 12"` only after checking a plugin that does not use
those keys against both. These descriptor keys are an additive API-11 change, so the major did not
move: the compatibility promise permits additions and forbids removing an API-11 name.

## Related

- `acorn-plugin-sdk` — the frame bridge, for a plugin's sandboxed UI.
- `create-acorn-plugin` — `npm create acorn-plugin`, which scaffolds a package already wired to both.
