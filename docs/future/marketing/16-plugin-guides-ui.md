# Phase 16: write the plugin tutorial and the UI guides

Date: October 15, 2026. Status: done. Needs phase 15. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

## Completion note

October 16, 2026. The tutorial, "Have your agent build it", "Choose how your plugin draws", the 20 UI
guides, and a new "Use the SDK and JSX" guide are written and published. Every guide's code comes from
a tested example plugin in `examples/plugins/`, and every picture is that example's own tree.
[Plugin guides and their examples](../../site/plugin-guides.md) is the reference for the examples, the
harness, and how a guide shows code and pictures.

What landed:

- **`@acorn/plugin-examples`**, a private workspace package at `examples/plugins/`, with seven
  examples: `hello-pane`, `acme-tracker`, `acme-review`, `acme-points` (`acme-board` and `acme-links`),
  `acme-frame`, `acme-theme`, and `acme-switcher`. All but `acme-review` are hand-written in the
  scaffold's no-build form. `pnpm-workspace.yaml` lists `examples/*`.
- **The harness**, `examples/plugins/test/harness.ts`: the Node's manifest parser, the testkit's real
  Node context with the manifest's own permissions, and the bridge handshake the host performs, with
  every message parsed by the protocol's `sandboxMessage`. `test/packed.ts` holds the packed-SDK
  helpers that used to live in the scaffold's test, which now imports them.
- **The test**, `examples/plugins/test/examples.test.ts`: every manifest parses, every route string
  it names is served, every tree entry it names mounts and draws, and each guide's promises hold.
  `acme-review` is built outside the repository from the packed SDK and types, as the old extension
  example test did from the doc's fenced blocks.
- **The pictures.** `apps/site/specimens/examples.json` lists 17. `test/pictures.test.ts` records each
  example tree against its Node half into `apps/site/src/generated/specimens/`, and the site and
  terminal generators draw them like any specimen. `pnpm --filter @acorn/site specimens` runs it first.
- **Code on a page.** `ExampleCode.astro` shows a `// #region` of an example file, or the parts of a
  manifest picked by dotted path, titled with the file's path. `src/lib/exampleCode.ts` does the
  cutting, with node tests.
- **The extension example** moved into `examples/plugins/acme-review/`, and its three internal pages
  link to the files. It gained a `core:markdown-fence` viewer and an `agents:transcript-attachment`
  viewer, so it fills eleven places, nine of them points.

The acceptance checks: the examples test passes, 39 cases with the pictures, and the scaffold's 24.
Every JSON block on the guides passes phase 15's manifest check, which caught one wrong "Wrong" example.
A production build writes 181 pages and passes the site's tests with 209 Playwright tests, and a preview
build passes all 295. `astro check` finds no errors. The architecture suite fails the same eight checks
it fails on the base commit, with nothing from this change.

### What the walk found

An agent walked the tutorial and the left rail guide in a `dev:agent` session, with the plugins in a
scratch folder outside the repository, then the reference panel, settings page, commands, notice,
attention, board pair, and switcher steps. Fixed on the way:

- **The scaffold's README said installing needs a restart.** Installing starts the plugin at once. The
  README now gives the real path, typing the folder into **Package** or **Choose…**, then **Accept
  plugin** once Settings closes, and how to reload.
- **There's no reload button.** Turning **Enabled** off and on re-reads the folder, and a changed bundle
  asks again with **Accept update**. The tutorial says so, and teaches development mode after it.
- **A bare text node beside a heading overprints the heading in the terminal.** The scaffold's greeting
  is wrapped in `Text` now.
- **A prop that's `undefined` makes the host refuse the whole batch.** The replacement switcher drew
  nothing in the real app, because a pane with no shortcut sent `meta: undefined`. JSON hid it in the
  pictures. `el()` drops undefined props, in the scaffold too, and the harness parses every batch.
- **A `Row` with `collapsedIcon` always draws collapsed.** The tracker list sent it at full width and
  drew a column of icons. It sends it only while `collapsed`, and the test checks.
- **A `rows` point in `pane.footer` draws only under a task pane.** The manifest accepts one on a
  project pane, and nothing draws. `acme-board` puts its rows under a task pane.

Not walked: the terminal client step. Its agent launcher runs its own Node, and the auto-mode classifier
refused reading that Node's credential to install the plugin there. The terminal pictures prove the
trees draw in cells, and the step is written from the terminal docs. Right-click menus and the
toolbar control weren't pressed, because the driver can't open a context menu or a running terminal
session. Their routes are tested.

### Decisions

- **A workspace package, not a folder of fixtures.** Both the scaffold's test and the examples test
  import the harness by package name, so `tools/arch/boundaries.test.ts` scans `examples/` as a library
  folder. The harness sits in `test/`, because it imports the testkit.
- **The examples package records the pictures, and the site lists them.** Starting a Node half needs
  the testkit, which the site doesn't load. The examples test writes the trees into the site's folder
  by path, as the terminal generator writes cells, and the site keeps the titles and captions.
  `renumber` moved into the examples package, and the site's generator imports it.
- **A manifest is cut by path, not by region.** JSON has no comments. `pick` keeps one array entry with
  `#id`.
- **The tracker's rail source draws from trees**, so its list and detail have pictures. The guide shows
  the `items` form too, and `acme-board` uses it.
- **Descriptors get the kit node the host draws**, captioned so, as phase 15 did: the badge guide shows
  the kit's badges, and the commands guide the palette snapshot. Menus, marks, notices, a frame, a
  webview, and a theme have no picture, and each guide says why.
- **The plumbing is copied into each hand-written `client.js`.** A client is one file with no imports,
  so the copy is the cost of the no-build form. `drawAll` lives only in the tracker, which uses it.
- **Development mode comes after two hand reloads in the tutorial,** following the phase's order, so a
  reader sees what it saves them.

### Deviations

- **"Use the SDK and JSX" is a new page**, at the end of **Draw in acorn**, and in the site map.
- **The tutorial has ten steps.** Accepting the plugin is its own step, between installing and opening.
- **No `content.selection` row in `acme-tracker`.** The menus guide shows the locations in a table and
  the example's three rows, plus `acme-review`'s `file.row`.
- **"How plugins work" stays a draft.** No phase owns it. Phases 13 and 14 asked to point links at it.
- **The scaffold's test lost a check.** It held `packages/plugin-types/README.md`'s example to the host
  major, and phase 15 removed the major from that README. It now checks that the README names none.

### Problems for their owners

- **Trust prompt copy.** An extension on `core:task`, `core:source`, or `core:pane` reads "Add its own
  rows to core's "Acme issues" list", using the extension's label as the owner's list name, three times.
  `acme-links` reads "Add its own rows to acme-board's "Pull requests" list", where "Pull requests" is
  its own label and the point is "Linked items".
- **The plugin page's Enabled row** says "Takes effect when the node next starts" for a loaded plugin,
  which takes effect at once.
- **The terminal draws a `Badge` inside a `TableCell` as `[object Object]`.** The tracker uses text in
  the cell.
- **A `pane.footer` point on a project pane** parses and never draws. Either the manifest should refuse
  it, or `register.ts` should draw it.
- **The Node service and the terminal client are over their size ceilings on the base commit**,
  1,855,253 bytes against 1,820,500, and 741,202 against 720,000. `dev:agent` and `dev:tui:agent` fail
  until someone trims them. `--prepared` and `--no-build` get around it.

### What later phases need to know

- Phase 17: add examples under `examples/plugins/`. The examples test picks up any folder with a
  manifest, one level of nesting allowed. Add props to `PROPS`, cases for each guide's promises, and
  pictures to `apps/site/specimens/examples.json`. Follow the guide shape in the reference.
- A hand-written tree must not send a prop that's `undefined`. Use the plumbing's `el()`.
- The guides link to `https://github.com/jamesmacfie/acorn/tree/main/examples/plugins/…`, which resolve
  once this merges.
- Phase 20: `npm create acorn-plugin` and the two SDK packages aren't on npm, and the tutorial's first
  step needs the first. A person walking the tutorial with published packages is still yours, and so
  is the terminal step.

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
