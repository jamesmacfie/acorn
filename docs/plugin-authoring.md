# Plugin authoring

This guide is for writing a loaded plugin as plain JavaScript files, installing the folder, and
iterating without a build step. The host uses the same manifest parser, loader, permissions, and route
namespace as for a bundled plugin. Start with [start from the scaffold](./plugin-authoring/start-from-the-scaffold.md).
The [plugin reference](./plugins.md) has the exact rules behind each page.

Keep node imports relative or use `node:` builtins, and bundle any npm runtime dependency before you
install. The client output must be one JavaScript file with no unresolved imports. The scaffold inlines
the bridge and the tree protocol, so a tree needs no bundler. Install `acorn-plugin-types` for editor
completion on the node context. [Contribution kinds](./contribution-kinds.md) says which features a
loaded plugin can use.
Dashboard-capable sources can return up to 10 `starterPlans` from `describe`. Each is a version 2
panel plan that reads your source, with no workspace or account in its scope. The host moves it onto
the account and reach the person picked, then validates it before offering it. The **Add panel**
launcher lists your starters when someone picks your source, and the source's inspector lists them
under **Start from**. Picking one replaces the panel's plan.
Static field choices can set `tone` (`ok`, `warn`, `bad`, `muted`, or `accent`) and numeric `rank`.
Those hints flow to panel enum columns unless the author overrides them.
For each source, state its default and selectable reach, the scope in its record identity, whether
it can return an account identity, field `viewerMatch` pointers or native viewer fields, time and
date-only precision, snapshot or event coverage, freshness, and honest upstream caps. A source with
partial history must give the dashboard enough information to distinguish an empty covered window
from an empty uncovered one. See [Typed data sources](./data-sources.md#identity-reach-time-and-coverage).
In the panel editor, a field with `viewerMatch` offers **You** as a filter value on a one-source
panel, and a declared `reach` shows as one **Reach** choice: everything the account can see,
workspace links, or chosen items.

## Start here

- [Start from the scaffold](./plugin-authoring/start-from-the-scaffold.md): create a package and check
  it.
- [Turn an app into a plugin](./agent-built-apps/project-apps.md#turn-into-a-plugin): start from a
  project app. Acorn writes the scaffold with `requires` filled in, and an agent rebuilds the app.
- [A complete example](./plugin-authoring/complete-example.md): a node half in two files and one
  frame pane.
- [Install a hand-written package](./plugin-authoring/installing-a-hand-written-package.md):
  installing, agent requests, load failures, and what the profile refuses.
- [Events and capabilities](./plugin-authoring/events-and-capabilities.md): short examples of talking
  to core and to other plugins.

## The manifest

`contentLinks` can declare a target without `match`, with a plugin-owned kind and item ID. A loaded
manifest may name a declared task pane or overlay and list supported presentations. Compiled plugins
register a target resolver through `ctx.contentLinks`. Sources describe target kinds and named record
actions separately from each record's current eligibility; the `actions` source operation must answer
for an exact record reference before a Node action runs.

- [The manifest](./plugin-authoring/the-manifest.md): top-level keys, required plugins, and the rules
  that check fields against each other.
- [Contributions](./plugin-authoring/contributions.md): every contribution key and its cap, the action
  verbs, and task checks.
- [Permissions](./plugin-authoring/permissions.md): node grants, frame scopes, and event channels.
- [Settings pages](./plugin-authoring/settings-pages.md): placement, search, and the plugin strip.
- [UI contributions](./plugin-authoring/ui-contributions.md): themes, style packs, context menus, and
  replacing a core surface.
- [Extensions](./plugin-authoring/extensions.md): opening a point and filling another plugin's, with
  a task-annotation example.
- [An extension example](./plugin-authoring/extension-example.md): a tested package that fills eleven
  places in other plugins' UI, with [its Node half](./plugin-authoring/extension-example-node.md) and
  [its trees](./plugin-authoring/extension-example-trees.md).
- [Harnesses](./plugin-authoring/harnesses.md) and [custom
  agents](./plugin-authoring/custom-agents.md): adding a managed agent with no code.
- [CLI command authoring](./plugin-authoring/cli-commands.md): headless commands.
- [Browser handoffs](./plugin-authoring/browser-handoffs.md): a button on a website that brings its
  item into an Acorn task.

## The two halves

- [The node half](./plugin-authoring/the-node-half.md): loading, the default export, and `ctx`.
- [Storage and migrations](./plugin-authoring/storage.md): owning tables and changing them.
- [Telemetry and logging](./plugin-authoring/telemetry.md).
- [Testing a plugin](./plugin-authoring/testing.md): test environments and the testkit.
- [Derived sources](./plugin-authoring/derived-sources.md): a data source built from other sources
  with `acorn-plugin-sdk/data`, from the scaffold to a panel.
- [The client half](./plugin-authoring/the-client-half.md): two ways to draw, trees, and the frame
  path.
- [The bridge](./plugin-authoring/the-bridge.md): the handshake, the verbs, and telemetry from a
  frame.

## Client-only packages

A device can install a plugin with a `client` entry and client contributions only. Leave out `node`,
`migrations`, Node permissions, and contributions that need a Node handler: routes, schedules, tools,
context sections, providers, harnesses, task checks, audit actions, data sources, and discovery
handlers. **Install…** under **Settings > Plugins > Installed**, aimed at **This device**, accepts
GitHub releases, npm packages, HTTPS tarballs, and local folders where the host has a folder picker.
Each new bundle hash needs trust on that device ([device-held
plugins](./plugins/client-half.md#device-held-plugins)).

A device-held rail source uses `tree: { list: 'listEntry', detail: 'detailEntry' }` in its source
descriptor, with both entries exported through `mountTree`. The `items` route form needs a Node
handler and is refused for a device install, and so are route-backed slots, commands, document
regions, attention, Node stats, agent contexts, reference resolvers, and extensions.

A Node-backed package can use the `tree` form too. The host pads the detail and makes it scroll. The
list's mount props carry `collapsed`, which is `true` while the reader has the list at icon width. Give
each row a `collapsedIcon`, a Lucide name, and a `label` for its tooltip then, and leave out headers
and toolbars. An icon element can't be a prop, because tree props are JSON.

## Drawing a diff

`DiffPane` is on `@acorn/plugin-api/ui` for compiled plugins. A loaded plugin's frame or tree can't
hand it a source, because a `DiffSource` is functions. A compiled plugin fills the port with a
document instead of patches ([the source port](./diff-rendering/document.md#the-source-port)). A source
written for plugin API major 1 moves like this:

- `files` becomes `topology`, a `DiffDocumentTopology`. Build it on your Node with
  `fileDocument(path, patch)` from `@acorn/diff-document/document` for each file and
  `documentTopology(files)` for the whole, and answer it from a route.
- `cachedFile` and `fetchPatches` become `loadSegments(requests, signal)`. Answer each
  `{ path, patchKey, ordinal }` with that segment's rows, cut from the patch the key names. Reject
  when you can't produce them, and refresh your topology.
- `search(request, signal)` answers a page with `searchDocument` over the same files.
- `contentSignature` and `contentKey` are gone. A segment is keyed by its patch digest, so a new
  topology reloads only what moved.
- `hasLineExtra` and `lineExtraSignature` become `lineExtra: { anchors, render }`, which names every
  line you draw under, up front.

Declare `"apiVersion": "5"`, or a range that covers it, once the source has moved.
