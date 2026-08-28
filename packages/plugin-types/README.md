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
  "apiVersion": "3"
}
```

## What is here, and what is not

Everything the host hands a loaded plugin: the context and its registries, `ctx.core` and its
facets, `TaskRef` and `ProjectRef`, the request context a route handler receives, and a catalogue of
every capability the first-party plugins publish.

A few members carry a type this package deliberately does not describe — the host's drizzle handle
behind `ctx.storage.open()`, a Zod schema on an agent-tool contribution. Adding either would mean
adding a dependency to a package that promises none. Narrow them yourself if you need to; the rest
of the surface is exact, and a test in the acorn repository fails if it drifts.

`apiVersion` is a range over plugin API majors: write `"3"`, or `"2 || 3"` once you have checked
your plugin against both.

## Related

- `acorn-plugin-sdk` — the frame bridge, for a plugin's sandboxed UI.
- `create-acorn-plugin` — `npm create acorn-plugin`, which scaffolds a package already wired to both.
