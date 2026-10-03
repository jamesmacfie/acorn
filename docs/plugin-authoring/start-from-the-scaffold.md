# Start from the scaffold

This page walks you through creating a plugin package with the scaffold and checking that it works.
It's part of [plugin authoring](../plugin-authoring.md).

## Create a package

1. Create a package with a remote tree:

   ```sh
   npm create acorn-plugin my-widget
   ```

   The scaffold writes `acorn-plugin.json`, `node/index.js`, `server/routes.js`, `client.js`, and a
   `README.md` with the install steps. The client file inlines the bridge handshake and the tree
   protocol, so there's no build step.

2. To check the node half in your editor, install the declaration package as a development
   dependency:

   ```sh
   npm install --save-dev acorn-plugin-types @types/node
   ```

   An installed node entrypoint must resolve its runtime imports without your development
   `node_modules`, so keep these out of runtime code.

3. Install the folder on a Node with the local-path source
   ([install a hand-written package](./installing-a-hand-written-package.md)), restart the Node, and
   accept the bundle when the device asks.

4. Open a task and run **Open My widget** from the command palette. The pane's button calls the Node
   route at `/v1/p/my-widget/greeting` through the bridge and updates the host-drawn tree with the
   answer.

The route lives in `server/routes.js`, so the entrypoint only registers. A reload starts a fresh Node
worker and evaluates imported modules again, so editing either file takes effect together.

For a browser-specific surface, such as a canvas, generate a frame instead:

```sh
npm create acorn-plugin my-widget -- --rectangle
```

A tree names shared components the host renders on the desktop and in the terminal. A frame renders
its own DOM in a desktop iframe ([two ways to draw](./the-client-half.md#two-ways-to-draw)).

To extend another plugin's UI after your own pane works, add an `extensions` entry for one of its
published points. For example, `agents:tool-card` accepts a tree, and `changes:diff-line` accepts
route-backed annotations ([extensions](./extensions.md)).

## The package

```text
my-widget/
  acorn-plugin.json
  README.md
  node/
    index.js
  server/
    routes.js
  client.js
  migrations/          only if the plugin owns tables
    meta/_journal.json
    0000_init.sql
```

The manifest filename is fixed, and the manifest declares the paths to the node entrypoint, the
client bundle, and any migrations ([the manifest](./the-manifest.md)). Keep the manifest `id` equal to
the node export's `name`. The id binds the route namespace, preferences, and the SQLite filename, so
keep it stable across updates ([storage and migrations](./storage.md)).

## Limits

The Node runs loaded plugins only on a patched Node release:
`>=22.23.2 <23 || >=24.18.1 <25 || >=26.5.1 <27` (`packages/protocol/src/runtime/nodeRuntime.ts`). On
an older release, the plugin's roster row reads `failed` with a reason that names both versions.

## Scaffold verification

`packages/create-acorn-plugin/index.test.ts` checks the API major, the schema URL, the manifest, a
route reload in a fresh worker, and both client handshakes. It runs the packed scaffold and
type-checks its node files outside the repository against the packed declaration package, which
catches dependencies that resolve only inside the workspace. It also type-checks the
[complete example](./complete-example.md) and checks that the manifest examples on these pages speak
the current API major.

On October 4, 2026, running the scaffold with `node packages/create-acorn-plugin/index.mjs my-widget`
produced the five files above with `"apiVersion": "3"`, and its manifest passed the Node's manifest
parser with no unrecognized keys.
