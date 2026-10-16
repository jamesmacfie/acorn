# Plugin guides and their examples

This page covers the public site's plugin guides: the example plugins behind them, the harness that
installs and runs each example, how a guide shows an example's code and pictures, and the shape every
guide follows. Read it before you add a guide or change an example. It's part of
[the public site](../site.md).

## The example plugins

Every guide's code lives in a real plugin under `examples/plugins/`, not in the page. The folder is a
private workspace package, `@acorn/plugin-examples`, so its tests run in `pnpm test`. Each example is a
folder an author could install as it is:

| Example | What it shows |
| --- | --- |
| `hello-pane` | The tutorial's end state: the scaffold's output plus the tutorial's two edits |
| `acme-tracker` | A rail source drawn from trees, a pane, a settings page, a reference panel, commands of all five kinds, a keybinding, menu rows, two slot badges, marks on `core:task`, `core:source`, and `core:pane`, an attention item, and a notice |
| `acme-review` | Eleven places in other plugins' views, written in JSX with the SDK. [An extension example](../plugin-authoring/extension-example.md) describes it |
| `acme-points/acme-board`, `acme-points/acme-links` | A pair: one opens a `rows` point and a mounted `remote` point, the other fills both |
| `acme-frame` | A frame that draws a canvas through the bridge and claims a chord, and a webview |
| `acme-theme` | A theme, a style pack, and brand marks, with no code |
| `acme-switcher` | A replacement pane switcher |
| `acme-agent` | Two agent tools, a context section, two custom agents, a skill, two hooks on agent tool calls, and a summary written with the plugin's model grant |
| `acme-harness` | A harness for an imaginary `acme-code` command line, with a one-shot mode, a stand-in for the command in `test/`, and the conformance script an author runs |
| `acme-data` | Its own SQLite table and migration, a typed data source with a starter panel, a workflow step kind, a schedule, a task check, a command-line command, an audit verb, a connection, an event and a capability `acme-tracker` uses, and a route loaded on first use |
| `acme-readiness` | A derived source in the scaffold's `--data-source` form, built with Vite against the SDK |
| `acme-browser` | A browser handoff on `example.com`, task addresses, and a browser sidebar panel |

Write a new example in the scaffold's no-build form, a hand-written `client.js`, because that's what
`npm create acorn-plugin` gives a new author. The multi-entry examples share one block of plumbing,
marked `Plumbing` at the top of each `client.js`: the scaffold's handshake with a table of entries and
a `draw` that redraws a slot. Change it in every copy at once. `acme-readiness` is the one exception,
because a derived source needs the SDK: it's the scaffold's `--data-source` output, built with Vite.
`packages/create-acorn-plugin/index.test.ts` fails when a `hello-pane` file the tutorial doesn't edit
differs from what the scaffold writes.

## The harness

`examples/plugins/test/harness.ts` does what the Node and the host do, without either:

- `readExample` parses the manifest with the Node's own `parsePluginManifest`, cross-field rules included.
- `startNode` imports the Node half fresh and runs `init` on the testkit's real context,
  `makeTestNodeContext`, with the manifest's own Node permissions, event grants, and migrations, and
  an owner when the test passes `userId`. `call` dispatches a full `/v1/p/<id>/…` path the way the
  Node's dispatcher does, as the device or as the `principal` a test names, such as an agent's task
  credential. `ctx` is the context, for seeding core's rows.
- `clientBundle` reads a hand-written `client.js`, or builds a bundled example with the Solid preset
  against this checkout's SDK source.
- `startWorker` runs the bundle in a VM context and performs the bridge handshake. `mount` sends
  `tree:mount` with a scoped bridge, answers the bridge's `api` calls from the Node half, answers every
  other request and `tree:host-request` with success, parses every message with the protocol's
  `sandboxMessage` as the host does, and waits until the tree stops drawing. `fire` presses a node.

`examples/plugins/test/packed.ts` holds the helpers for building outside the repository against the
packed SDK and types: `unpackPublishedPackage`, `copyNodeTypes`, `linkTool`, `TSC`, and `run`. The
scaffold's tests use them too.

`examples/plugins/test/examples.test.ts` checks, for every folder with a manifest: the manifest
parses, every route string the manifest names is served, and every tree entry it names mounts and
draws. Then it checks what each guide says its example does, and builds `acme-review` outside the
repository from the packed SDK. A Node half that's built, such as `acme-readiness`'s, is checked by its
own example's test instead.

`examples/plugins/test/nodeExamples.test.ts` holds the Node half guides' promises, each answer parsed
with the schema the host applies to it. It drives `acme-harness`'s stand-in agent over the Agent Client
Protocol with the published SDK, runs its conformance script, generates text through a fake model
provider registered the way a model-provider plugin registers one, and builds `acme-readiness` outside
the repository from the packed SDK, running its own test.

## Code on a guide

`apps/site/src/components/ExampleCode.astro` shows code from an example file, titled with its path
under `examples/plugins/`:

- `region="name"` shows the lines between `// #region name` and the `// #endregion` that closes it.
  Regions nest. Other markers are left out.
- `pick={['contributions.sources', 'contributions.frames#settings']}` shows those parts of a
  manifest, as a manifest of their own. `#id` keeps one array entry. JSON has no comments, so a
  manifest is cut by path.
- With neither, the whole file, without markers.
- `lang` sets the highlighting for a file whose name has no extension, such as a script found on
  `PATH`. Files ending in `.sql` and `.md` can be shown too, and so can the examples' own tests in
  `examples/plugins/test/`.

A file, region, or path that isn't there fails the build. The cutting is in
`apps/site/src/lib/exampleCode.ts`, with its tests beside it. Every other JSON block on a guide is
marked `json manifest` or `json manifest-invalid`, and `apps/site/scripts/referenceExamples.test.ts`
parses it ([generated references](./references.md#the-plugin-reference)).

## Pictures on a guide

`apps/site/specimens/examples.json` lists each picture: its specimen ID, the example, the tree entry,
the props and context to mount it with, route calls to set data up first, and the specimen's title,
caption, and sizes. `examples/plugins/test/pictures.test.ts` mounts each against its example's Node
half and commits the batches as `apps/site/src/generated/specimens/<id>.tree.json`, by path, as the
terminal generator writes cells. The site's generator then draws the HTML and the terminal client's
draws the cells, as for any [specimen](./specimens.md). `pnpm --filter @acorn/site specimens` runs the
examples' recording, then the site's, the terminal client's, and the extension's generators, in that order, and `UPDATE_SPECIMENS=1` rewrites them.

A descriptor, such as a badge, has no tree of its own, so its guide shows the kit node the host draws
it with, captioned so. A frame and a theme have no picture, and their guides say why.

A Node half guide draws nothing of its own, so its result is what it changes: a shell snapshot, such
as the Context pane, a browser extension picture, such as `sidebar-plugin-panel` from
`apps/extension/src/sidebar/pictures.test.tsx`, or the text a person reads, such as a trust prompt line
or command-line output.

## The shape of a guide

Every guide under **Draw in acorn** has the same sections, in this order: one sentence saying what
you'll add, **The result** with the example's picture, **Before you start**, numbered **Steps** with
each code block from an example, **Mistakes** with each wrong manifest beside the right one, **In the
terminal**, **Limits**, and **Reference** links to the contribution pages. A guide for the Node
half follows the same shape, with its own examples in the same folder and the same harness.

## Add an example or a guide

1. Add the folder under `examples/plugins/`. If a tree needs props to draw, add them to `PROPS` in
   `examples.test.ts`, and add a case for what the guide promises.
2. Mark the regions a guide shows.
3. List its pictures in `apps/site/specimens/examples.json` and run
   `UPDATE_SPECIMENS=1 pnpm --filter @acorn/site specimens`.
4. Write the page, cite the example's files in `sources`, and run
   `pnpm --filter @acorn/site stale -- --mark <page>`.
