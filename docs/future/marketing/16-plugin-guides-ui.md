# Phase 16: write the plugin tutorial and the UI guides

Date: October 15, 2026. Status: proposed. Needs phase 15. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

## Goal

A developer builds their first plugin from the tutorial, then finds a guide for every place a plugin
can draw: the left rail, the right rail, a pane, Settings, the palette, menus, the top bar, another
plugin's view, and more. Every guide is backed by an example plugin that a test installs and runs, and
every guide shows what its example draws, on the desktop and in the terminal.

## Starting point

- `npm create acorn-plugin` (`packages/create-acorn-plugin/index.mjs`) writes a plugin with no build
  step: a manifest, a two-file Node half, and a plain JavaScript `client.js` that builds its tree with a
  small `el(type, props, children)` helper. `--rectangle` writes a frame instead.
- The extension example in `docs/plugin-authoring/extension-example.md` fills nine places in other
  plugins' UI. `packages/create-acorn-plugin/index.test.ts` pulls its code out of the doc's fenced
  blocks, then builds, type-checks, and runs it against the packed SDK outside the repository.
- [Contribution kinds](../../contribution-kinds.md#places-to-fill) lists every place one plugin can add
  UI to another's.
- yazi's plugin docs put the file path at the top of every code block, and show mistakes in their own
  labeled blocks ([research](./research.md#yazi-rsgithubio)).

## Example plugins

Every guide's code lives in a real plugin under `examples/plugins/<name>/` (new folder), not in the page.
The page imports code regions from the files, marked with `// #region name` comments, so the code on the
page is the code the test runs. Group examples by theme so there are a handful to maintain, not one per
guide:

| Example | What it shows | Guides |
| --- | --- | --- |
| `hello-pane` | The tutorial: a pane with a tree and a Node route. | Build your first plugin |
| `acme-tracker` | A left rail source with list and detail, a pane, a settings page, commands of all five kinds, keybindings, context menu rows, a top bar badge, task and source marks, an attention item, and a notification. | Most of the guides below |
| `acme-review` | The extension example from the internal docs, moved into files: extension points, a toolbar control, a link preview, a file viewer, an artifact viewer, a tool card, a detail region, and document services. | Add to another plugin's view, and its neighbors |
| `acme-points` | A pair: one plugin opens an extension point and another fills it. | Open your view to other plugins |
| `acme-frame` | A frame that draws its own pixels through the bridge, and a webview. | Draw your own pixels, show a web page |
| `acme-theme` | A theme, a style pack, an icon, and a brand mark. | Add a theme or a style pack, add icons |
| `acme-switcher` | A replacement pane switcher in the right rail's exclusive slot. | Replace the top bar, rail, or pane switcher |

Write examples in the scaffold's no-build form, because that's what `npm create acorn-plugin` gives a
new author. `acme-review` keeps its SDK and JSX form, and one guide, "Use the SDK and JSX", explains the
bundled form using it.

Test every example the same way:

1. Move the packed-SDK harness out of `packages/create-acorn-plugin/index.test.ts` into a helper both
   tests call. Point the extension example test at `examples/plugins/acme-review/` instead of the
   doc's fenced blocks, and change `docs/plugin-authoring/extension-example.md` to link to the folder.
2. For each example: parse its manifest with `pluginManifestShape`, start its Node half with the
   testkit and call each route its manifest names, and mount each tree entry through the bridge
   handshake the harness already performs.
3. Record each tree entry's batches into phase 3's pipeline, so the guide's picture is the example's
   own output on both hosts.

## The tutorial: build your first plugin

One page, numbered, with a checkpoint after each step that says what the reader should see:

1. Scaffold `hello-pane` with `npm create acorn-plugin`.
2. Read the three files and what each is for.
3. Install it from its folder, and accept the trust prompt. Show the prompt as a specimen.
4. Open the pane from the palette.
5. Change the tree, reload, and see the change.
6. Add a route on the Node half and call it from the tree.
7. Open the same task in the terminal client and see the same pane.
8. Turn on development mode so edits reload without a prompt.
9. Where to go next.

A second short page, "Have your agent build it", covers asking an agent in an acorn task to write a
plugin: the `plugin_authoring` tool gives it the vocabulary of your Node, `plugin_request` asks you to
install it, and development mode keeps the loop short.

A third, "Choose how your plugin draws", explains descriptors for facts, trees for UI, and frames for
pixels, with a specimen of each.

## The guides

Every guide has the same shape:

1. **One sentence**: what you'll add.
2. **The result**: the example's specimen, desktop and terminal.
3. **Before you start**: what the reader needs, usually the tutorial.
4. **Steps**: the manifest entry, the tree or route code, reload, and check it on both hosts. Every code
   block starts with its file path.
5. **Mistakes**: the errors people make, each as a block labeled as wrong with the fix beside it. Take
   them from the Node's refusal messages and from the manifest's cross-field rules.
6. **Limits**: caps, and what the terminal client doesn't draw.
7. **Reference**: links to the contribution pages from phase 15.

Write one guide per row:

| Guide | What it has to make clear |
| --- | --- |
| Add a pane | `frames` with `target: 'pane'`, picking one of the eight named layouts, filling its regions, and opening the pane. |
| Add a source to the left rail | A `sources` entry, its list and detail trees or routes, the collapsed icon width, **Show in left rail** and its default, and status marks on the source. |
| Put your pane in the right rail | How a pane appears in the pane switcher, its icon and label, pinning, and its chord. The right rail lists panes, so a plugin reaches it by adding a pane. |
| Add a reference panel | A panel beside an external item, opened by another plugin with `openRefPanel`. |
| Add a settings page | Placement by `category`, `sections` and `keywords` for search, the `SettingsSection` and `SettingRow` nodes, and the plugin strip. |
| Add commands and keybindings | The five command kinds, groups, search and input routes, setting commands, chords, and why a binding that already works wins. |
| Add rows to context menus | Task rows, item rows, your own rail icons, Editor's files and tabs, transcript messages, and selected text, with the `when` vocabulary. |
| Put a badge in the top bar or task footer | `slots`, what a badge can show, and keeping it fresh. |
| Mark tasks, sources, and panes | The `core:task`, `core:source`, and `core:pane` annotation points, and how marks draw in the terminal. |
| Add to another plugin's view | Filling a point: rows, annotations, trees, and rectangles, with consent from the owner's manifest, using `acme-review`. |
| Open your view to other plugins | Declaring a point, its kind, props, and actions, and mounting it, using `acme-points`. |
| Add a toolbar control | The preview and terminal toolbar points, and `reload` and `interrupt`. |
| Preview links and draw code fences | `core:link-preview` and `core:markdown-fence`. |
| View files and agent attachments | `editor:document`, `agents:artifact`, and `agents:transcript-attachment`. |
| Replace the top bar, rail, or pane switcher | Exclusive slots, the data and verbs the host passes, the fallback to core, and what the person picks in Settings. |
| Draw your own pixels in a frame | The frame origin, the bridge, the handshake and its budgets, and claiming keys. |
| Show a web page | `target: 'webview'`, its hosts, and what it can't do in the terminal. |
| Add a theme or a style pack | The 22 palette colors, the style token families and their allowed values, and why both are data. |
| Add icons and brand marks | Lucide names, `icon` and `icons` in the manifest, brand mark paths and colors, and terminal glyphs. |
| Notify the person | Notices, attention items, and when to use each. |
| Use the SDK and JSX | Bundling a client with `acorn-plugin-sdk/remote`, and why a client must be one file. |

## Out of scope

The Node half beyond the routes these examples need, agent integration, data, and the browser
extension. Those are [phase 17](./17-plugin-guides-node-and-agents.md).

## Acceptance

- Every example plugin passes its test, and the extension example test reads `acme-review` from its
  folder.
- Every code block in these guides comes from an example file region or passes phase 15's manifest
  check.
- Every guide shows its example's specimen on both hosts, or says why the terminal draws nothing.
- Following only the published pages, an agent completes the tutorial and then the left rail guide in a
  scratch folder outside the repository. Record each step the pages got wrong or left out, and fix it.
  A person walking it with only the published packages is [phase 20](./20-launch.md)'s job.
