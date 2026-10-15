# An extension example

This page describes a complete loaded plugin that fills eleven places in other plugins' UI, built
against the packed SDK outside the acorn repository. Use it to copy a working declaration for one
point. It's part of [plugin authoring](../plugin-authoring.md). The code is in
[`examples/plugins/acme-review/`](../../examples/plugins/acme-review/), the Node half is explained in
[the example's Node half](./extension-example-node.md), and the trees in
[the example's trees](./extension-example-trees.md).

## What it shows

The plugin, `acme-review`, keeps a list of files under review in each task. Each row is one manifest
entry and the code behind it:

| Example | Declaration | Carrier |
| --- | --- | --- |
| A task pane and a file menu row | `frames` pane `review`, `contextMenus` on `file.row` | Tree `pane`, route `/add` |
| A tool-card replacement | `agents:tool-card` for the plugin's own `acme-review_files` tool | Tree `toolCard`, route `/tools/files` |
| An additive toolbar control | `terminal:toolbar-actions` | Tree `interrupt` |
| A batched file mark | `editor:file` | Route `/marks` |
| A media reader with a capability | `agents:artifact` and `agents:transcript-attachment` for `text/csv`, `agents.transcriptMedia` | Tree `csvMedia`, route `/artifact` |
| A file viewer | `editor:document` for `*.csv` | Tree `csvFile` |
| A link preview | `core:link-preview` for `https://docs.example.com/*` | Tree `docsPreview`, route `/docs` |
| A code fence viewer | `core:markdown-fence` for ` ```review ` | Tree `checklist` |
| A detail region | `linear:issue-summary` | Tree `issueReview`, route `/issue` |
| Document service routes | `documentServices` for `markdown` | Routes `/hover` and `/diagnostics` |

Every answer is fixed data in the Node half, so the example needs no network or account. Call the
`plugin_authoring` agent tool for every point's props and key on the Node you run.

## Build it

`acorn-plugin-sdk` and `acorn-plugin-types` aren't on npm. Pack both from an acorn checkout:

```sh
mkdir -p ~/acorn-packs
pnpm --filter acorn-plugin-sdk pack --pack-destination ~/acorn-packs
pnpm --filter acorn-plugin-types pack --pack-destination ~/acorn-packs
```

Then copy the folder beside `acorn-packs` and run `npm install`, `npm run build`, and `npm run check`.
The build writes `dist/client.js`, and the check type-checks both halves. The folder holds six files:

| File | What it is |
| --- | --- |
| [`package.json`](../../examples/plugins/acme-review/package.json) | The two packed tarballs, Solid, and the build tools. Its `overrides` point the SDK's own dependency on `acorn-plugin-types` at the same tarball |
| [`vite.config.ts`](../../examples/plugins/acme-review/vite.config.ts) | Compiles JSX into calls to the SDK's remote module, so components become acorn's tree, not DOM, and writes one file with Solid and the SDK inlined, because a client bundle can't import |
| [`tsconfig.json`](../../examples/plugins/acme-review/tsconfig.json) | Strict checking for the trees and the Node half |
| [`acorn-plugin.json`](../../examples/plugins/acme-review/acorn-plugin.json) | The manifest |
| [`node.js`](../../examples/plugins/acme-review/node.js) | [The Node half](./extension-example-node.md) |
| [`src/client.tsx`](../../examples/plugins/acme-review/src/client.tsx) | [The trees](./extension-example-trees.md) |

In the manifest, `events` lets the pane hear the plugin's own channel. `capabilities` lets the Node
half read artifacts, and `requires` names the plugin that provides them. Each `remote` names a key the
bundle passes to `mountTree`. A `matches` pattern is an exact key, `prefix*`, or `*suffix`.

## Install and try it

Install the folder with the local-path source, restart the Node, and accept the bundle
([install a hand-written package](./installing-a-hand-written-package.md)). Then, in a task:

1. Right-click a file in Editor's tree and choose **Add to review**. The row gains a mark, and
   **Open Review** lists the file.
2. Ask an agent to call `acme-review_files`. Its card lists the files.
3. Open a `.csv` file. Editor draws the table, with **Source** one toggle away.
4. Write a Markdown file with `TODO` in it. Each one gets a warning, and hovering one explains it.
5. Hover `https://docs.example.com/guide/review` in an agent reply or a note to see its preview.
6. Ask an agent to answer with a ` ```review ` fence listing file paths. It draws as a checklist.

The **Interrupt** button sits beside the terminal's **Stop**. A CSV artifact and a Linear issue
detail need an agent that writes `text/csv` and a Linear connection. In the terminal client, the
menu row is under the tree's **Actions** button, a link preview opens from the link's menu, and
Editor's **Diagnostics** button checks the saved file instead of a hover
([contextual points in the terminal](../tui/plugin-losses.md#contextual-points)).

When something doesn't draw, open **Settings > Advanced > Extension points**. It lists each point's
contributors, their `matches`, the reason a tree last failed, and every extension whose point nobody
declares ([seeing what matched](../plugins/cooperative-extension-points.md#seeing-what-matched)).

`examples/plugins/test/examples.test.ts` builds this example from its folder against the packed SDK
and types, type-checks it, mounts each tree entry the manifest names, and calls the routes. The public
site's plugin guides show its trees ([the example plugins](../site/plugin-guides.md)).
