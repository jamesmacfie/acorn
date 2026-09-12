# Start from the scaffold

[Plugin authoring](../plugin-authoring.md)

Create a package with a remote tree:

```sh
npm create acorn-plugin my-widget
```

The scaffold writes a manifest, a node entrypoint, a route module, and one client file. It inlines the
bridge handshake and tree protocol, so no build step is required. The default example contributes a
card to `agents:tool-card` and an annotation to `changes:diff-line`. Remove contributions you do not need.

For browser-specific UI, generate a frame instead:

```sh
npm create acorn-plugin my-widget -- --rectangle
```

Trees name shared components that the host renders on desktop or terminal. Frames render their own
DOM in a desktop iframe. Use a frame for a canvas or other browser-specific surface.

To check the node half in your editor, install the declaration package:

```sh
npm install --save-dev acorn-plugin-types @types/node
```

These are development dependencies. An installed node entrypoint must resolve its runtime imports
without the author's development `node_modules` directory.

## The package

```text
my-widget/
  acorn-plugin.json
  node/
    index.js
  server/
    routes.js
  client.js
  migrations/
    meta/_journal.json
    0000_init.sql
```

Include `migrations/` only if the plugin owns tables. The manifest filename is fixed; it declares
the paths to the node entrypoint, client bundle, and migrations. Keep the plugin's manifest `id`
equal to the node export's `name`.

The ID binds the route namespace, preferences, and SQLite filename. Keep it stable across updates.
For the manifest fields, see [The manifest](./the-manifest.md). To install and run the package,
follow [Install a package](./installing-a-hand-written-package.md).

## Scaffold verification

`packages/create-acorn-plugin/index.test.ts` checks the API major, schema URL, manifest, and node
entrypoint. It also type-checks the generated node files outside the repository against the standalone
declarations. This catches dependencies that resolve only inside the workspace.
