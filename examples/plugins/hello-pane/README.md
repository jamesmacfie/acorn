# Hello pane

An acorn plugin. No build step: these files are what runs.

```text
acorn-plugin.json   the manifest — the only file the loader trusts about this directory
node/index.js       default-exports the NodePlugin
server/routes.js    owns the starter route
client.js           one file, plain JS, no imports
```

## Two ways to draw

This scaffold's `client.js` is a **tree**, which is the default and what most plugins want. Your code
runs in a Web Worker with no DOM at all and names acorn's own components, which the host mounts. You
give up drawing your own pixels and you get the shell's keyboard handling, focus, ARIA and the
reader's chosen style pack, for free and forever.

Open a task, then run **Open Hello pane** from the command palette to show the starter pane. Its button
calls `/v1/p/hello-pane/greeting` through the bridge and updates the tree with the Node's answer.

`npm create acorn-plugin hello-pane -- --rectangle` emits the other one: a **frame**, a sandboxed iframe
whose pixels are yours. You write the markup and the CSS, and you get a rectangle.

Pick the rectangle when the surface owns its pixels — a chart, an image editor, a canvas. Pick the
tree for everything else.

## Types, if you want them

```sh
npm i -D acorn-plugin-types
```

Declarations only, no runtime, nothing to bundle. `node/index.js` already carries the JSDoc
annotation that picks it up, so `ctx` and everything under it is typed in your editor the moment the
package is installed. There is no build step either way: these files are still what runs.

## Install it

**Settings → Plugins → Installed → Install…**, source **Local folder**, with this directory: click
**Choose…**, or type its absolute path into **Package**. Then close Settings and click **Accept plugin**
when acorn asks.

A local folder is **linked**, not copied, so you edit in place. Installing starts the plugin in the
running Node. Each device asks its own owner before running client bytes, keyed by
`(pluginId, hash)`, so rewriting `client.js` asks again. To run an edit, turn the plugin's
**Enabled** switch off and on, or turn on **Development mode** on its **Permissions** tab, which reloads
it a moment after you save and runs each new version without asking.

If an **agent** is writing this plugin, it never reaches the install route: it asks with the
`plugin_request` tool and you approve in the shell. Approving with `dev: true` turns the loop into
edit → reload instead of edit → prompt → restart. Reload starts a fresh Node worker, so edits to
`node/index.js` or `server/routes.js` take effect together.

## Change it

- **Descriptors for facts, trees for UI, rectangles for pixels.** A chip, a badge, a menu row or a
  palette entry is a descriptor you declare and the host draws, and it stays live when nothing of
  yours is mounted. A pane, a panel body or a settings page is a tree. A frame is for pixels the host
  cannot draw.
- **Your routes are confined to `/v1/p/hello-pane/`**, at parse time and again at runtime.
- **The id is permanent.** It is the route namespace, the renderer route prefix, the persisted layout
  key and the SQLite filename. Renaming is "new plugin, plus a data migration, plus a tombstone".
- **`apiVersion` must cover the loading node's major.** `"5"` covers major 5; a tested plugin can
  declare a range such as `"4 || 5"`. A range that excludes the host is a `failed` roster row.

## Extend another plugin's UI

Add an `extensions` entry naming a point, such as `editor:document` for a file viewer or
`core:link-preview` for a link preview, or a `contextMenus` row on `file.row`. Three places say what
the running host accepts:

- The `plugin_authoring` agent tool lists every point with its key, props, actions and terminal
  differences, plus each menu location's facts and the language-service coordinates.
- **Settings → Advanced → Extension points** shows each point's contributors, their `matches`, the
  reason a tree last failed, and every extension whose point nobody declares.
- `docs/plugin-authoring/extension-example.md` in the acorn repository is a tested plugin that fills
  eleven places in other plugins' UI, built with the SDK.

The full contract is `docs/plugin-authoring.md` in the acorn repository. An agent should call the
`plugin_authoring` tool first — it answers with that guide plus the connected node's *current*
manifest vocabulary read off its own schemas, which is the only way to be sure the answer is not from
memory.
