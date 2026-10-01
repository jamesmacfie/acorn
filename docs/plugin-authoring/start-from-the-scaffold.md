# Start from the scaffold

[Plugin authoring](../plugin-authoring.md)

Create a package with a remote tree:

```sh
npm create acorn-plugin my-widget
```

The scaffold writes a manifest, a node entrypoint, a route module, and one client file. It
inlines the bridge handshake and tree protocol, so no build step is required. Open a task and run
**Open My widget** from the command palette to show its pane. The button calls the Node route at
`/v1/p/my-widget/greeting` through the bridge and updates the host-rendered tree with its answer.
The route lives in `server/routes.js`, leaving the entrypoint focused on registration. Reload starts
a fresh Node worker and re-evaluates its imported modules too.

To extend another plugin's UI, declare an `extensions` entry for one of its published extension points.
For example, `agents:tool-card` accepts a tree, while `changes:diff-line` accepts route-backed
annotations. Add those after the plugin's own pane works. See [The manifest](./the-manifest.md) for
the contribution shapes and host checks.

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

The scaffold tests check the API major, schema URL, manifest, Node route reload, and both client
handshakes. They also run the packed scaffold and type-check its Node files outside the repository
against the packed declaration package. This catches dependencies that resolve only inside the
workspace.
