# An extension example

This page is a complete loaded plugin that fills nine places in other plugins' UI, built against the
packed SDK outside the acorn repository. Use it to copy a working declaration for one point. It's part
of [plugin authoring](../plugin-authoring.md). The Node half is in
[the example's Node half](./extension-example-node.md), and the trees are in
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
| A media reader with a capability | `agents:artifact` for `text/csv`, `agents.transcriptMedia` | Tree `csvArtifact`, route `/artifact` |
| A file viewer | `editor:document` for `*.csv` | Tree `csvFile` |
| A link preview | `core:link-preview` for `https://docs.example.com/*` | Tree `docsPreview`, route `/docs` |
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

Then make a folder beside `acorn-packs`, write the six files from these pages into it, and run
`npm install`, `npm run build`, and `npm run check`. The build writes `dist/client.js`, and the check
type-checks both halves.

## `package.json`

```json
{
  "name": "acme-review",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "build": "vite build", "check": "tsc --noEmit" },
  "devDependencies": {
    "@types/node": "^26.0.0",
    "acorn-plugin-sdk": "file:../acorn-packs/acorn-plugin-sdk-1.1.0.tgz",
    "acorn-plugin-types": "file:../acorn-packs/acorn-plugin-types-1.0.0.tgz",
    "solid-js": "^1.9.13",
    "typescript": "^6.0.3",
    "vite": "^8.0.16",
    "vite-plugin-solid": "^2.11.12"
  },
  "overrides": { "acorn-plugin-types": "$acorn-plugin-types" }
}
```

The override points the SDK's own dependency on `acorn-plugin-types` at the same tarball.

## `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// JSX compiles to calls into the SDK's remote module, so components become acorn's tree, not DOM.
// The output is one file with Solid and the SDK inlined, because a client bundle can't import.
export default defineConfig({
  plugins: [solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })],
  build: {
    lib: { entry: 'src/client.tsx', formats: ['es'], fileName: () => 'client.js' },
    outDir: 'dist',
  },
})
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "bundler", "lib": ["ES2023", "DOM"],
    "jsx": "preserve", "jsxImportSource": "solid-js", "types": ["node"],
    "allowJs": true, "checkJs": true, "strict": true, "noEmit": true
  },
  "include": ["src", "node.js"]
}
```

## `acorn-plugin.json`

```json
{
  "id": "acme-review",
  "name": "Acme review",
  "version": "1.0.0",
  "baseline": "acorn-1",
  "apiVersion": "3",
  "node": "./node.js",
  "client": "./dist/client.js",
  "requires": { "plugins": [{ "id": "agents" }] },
  "permissions": {
    "api": [],
    "events": ["plugin:acme-review:changed"],
    "node": { "core": [], "capabilities": ["agents.transcriptMedia"], "secrets": false, "exec": false, "net": [] }
  },
  "contributions": {
    "frames": [{
      "target": "pane", "id": "review", "label": "Review", "glyph": "list-checks",
      "layout": "single", "regions": { "body": { "kind": "remote", "entry": "pane" } }
    }],
    "commands": [{
      "id": "open", "kind": "action", "title": "Open Review", "category": "pane",
      "action": { "verb": "openPane", "pane": "review" }
    }],
    "contextMenus": [{
      "id": "add", "location": "file.row", "label": "Add to review", "when": { "directory": false },
      "action": { "verb": "runNodeAction", "path": "/v1/p/acme-review/add" }
    }],
    "agentTools": [{
      "id": "files", "description": "List the files under review in this task.",
      "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
      "risk": "read", "handler": "/v1/p/acme-review/tools/files"
    }],
    "documentServices": [{
      "id": "todos", "label": "Review TODOs", "languageId": "markdown",
      "hover": { "route": "/v1/p/acme-review/hover" },
      "diagnostics": { "route": "/v1/p/acme-review/diagnostics" }
    }],
    "extensions": [
      { "id": "marks", "point": "editor:file", "label": "Review", "items": "/v1/p/acme-review/marks" },
      { "id": "tool-card", "point": "agents:tool-card", "label": "Review files", "remote": "toolCard",
        "matches": ["acme-review_files"] },
      { "id": "interrupt", "point": "terminal:toolbar-actions", "label": "Interrupt", "remote": "interrupt" },
      { "id": "csv-artifact", "point": "agents:artifact", "label": "CSV table", "remote": "csvArtifact",
        "matches": ["text/csv"] },
      { "id": "csv-file", "point": "editor:document", "label": "CSV table", "remote": "csvFile",
        "matches": ["*.csv"] },
      { "id": "docs", "point": "core:link-preview", "label": "Acme docs", "remote": "docsPreview",
        "matches": ["https://docs.example.com/*"] },
      { "id": "issue", "point": "linear:issue-summary", "label": "Review status", "remote": "issueReview" }
    ]
  }
}
```

`events` lets the pane hear the plugin's own channel. `capabilities` lets the Node half read
artifacts, and `requires` names the plugin that provides them. Each `remote` names a key the bundle
passes to `mountTree`. A `matches` pattern is an exact key, `prefix*`, or `*suffix`.

## Install and try it

Install the folder with the local-path source, restart the Node, and accept the bundle
([install a hand-written package](./installing-a-hand-written-package.md)). Then, in a task:

1. Right-click a file in Editor's tree and choose **Add to review**. The row gains a mark, and
   **Open Review** lists the file.
2. Ask an agent to call `acme-review_files`. Its card lists the files.
3. Open a `.csv` file. Editor draws the table, with **Source** one toggle away.
4. Write a Markdown file with `TODO` in it. Each one gets a warning, and hovering one explains it.
5. Hover `https://docs.example.com/guide/review` in an agent reply or a note to see its preview.

The **Interrupt** button sits beside the terminal's **Stop**. A CSV artifact and a Linear issue
detail need an agent that writes `text/csv` and a Linear connection. In the terminal client, the
menu row is under the tree's **Actions** button, a link preview opens from the link's menu, and
Editor's **Diagnostics** button checks the saved file instead of a hover
([contextual points in the terminal](../tui/plugin-losses.md#contextual-points)).

When something doesn't draw, open **Settings > Advanced > Extension points**. It lists each point's
contributors, their `matches`, the reason a tree last failed, and every extension whose point nobody
declares ([seeing what matched](../plugins/cooperative-extension-points.md#seeing-what-matched)).

`packages/create-acorn-plugin/index.test.ts` builds this example from these pages against the packed
SDK and types, type-checks it, checks each tree entry the manifest names, and calls the routes.
