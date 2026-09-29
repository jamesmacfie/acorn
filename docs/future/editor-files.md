# Plugin renderers for files in the editor

Status: design proposal, 2026-09-29. Not started. Raster image preview shipped the same day as a
built-in branch of the editor ([editor.md](../editor.md)); nothing here is built.

## Summary

Let another plugin draw a file in the editor pane: a markdown preview, a PDF viewer, a Mermaid
diagram. The editor opens one cooperative extension point keyed by the file, and keeps CodeMirror
and the built-in image preview as the fallback that draws when nobody matches. It also offers a
read-only node capability so a contributor can fetch the file's bytes without being granted the
whole filesystem.

Almost all of the machinery exists. `Slot`, `replace` arbitration, the per-key tie picker in
**Settings > Plugins**, compiled `component` contributions, loaded `remote` contributions, iframe
rectangles, and the binary bridge all shipped for other owners. The editor is the missing owner.

The renderer catalogue at the end is the list of third-party plugins this makes possible. None of them
belongs in the editor itself.

## Problem and evidence

`plugins/editor/src/client/EditorPane.tsx` chooses what to draw with fixed branches: the terminal
PTY in terminal mode, `ImagePreview` when `imageTypeForPath` in
`plugins/editor/src/contract/imagePreview.ts` recognises the extension, and CodeMirror otherwise.
Every new format is another branch in the pane and another dependency in the editor bundle.

The editor already opens two seams to other plugins, both on the node:

- `editor:line-markers`, declared in `plugins/editor/src/node/index.ts` and typed in
  `plugins/editor/src/contract/lineMarkers.ts`. Changes and GitHub fill it.
- The `before-save` hook, in the same file.

It declares no client extension point, so no plugin can draw in the pane.

The platform's own design names this case. `docs/plugins/cooperative-extension-points.md` uses an
`editor:beside` rectangle filled by a markdown preview for `*.md` as its example of the rectangle
kind. No code declares that point.

## What already exists

The owner side, for a compiled pane:

- `Slot` in `packages/client-core/src/host/tree/Slot.tsx`, exported from
  `packages/plugin-api/src/ui/host.ts`. The owner writes its default view as the slot's children.
  `occupied` reports whether a contributor is standing in, so the owner can keep drawing controls a
  contributor must not own.
- `replace` mode and `matches` resolution in `packages/client-core/src/host/tree/arbitration.ts`.
  `matches` takes an exact string, a trailing star, or a leading star, so `*.md` works as written.
  When two contributors match one key, the owner's default draws until the user picks one.
- `InlineSlot` in `packages/client-core/src/host/frames/InlineSlot.tsx`, the iframe version, exported
  from the same host entrypoint.
- `ctx.extensionPoints.register` on the client. `plugins/agents/src/client/index.ts` registers
  `agents:attachment` this way, and `plugins/agents/src/client/composer/AttachmentSlot.tsx` is the
  closest precedent: a `replace` point keyed by media type, with the owner keeping the remove button
  outside the slot.

The contributor side:

- A compiled plugin calls `ctx.extensions.register({ point, matches, component })`.
  `plugins/memory/src/client/index.ts` fills `context:section` this way.
- A loaded plugin declares an `extensions` entry with a `remote` carrier in its manifest, and its tree
  runs in the plugin worker. Or it declares an `inline` frame for a rectangle point.
- The binary bridge, `bridge.api.getBytes`, capped at `MAX_PLUGIN_BYTES` (12 MiB) in
  `packages/protocol/src/plugin/bridge.ts`. See the "Binary bridge calls" section of
  [frames.md](../plugins/frames.md).
- The read-only capability pattern: `plugins/agents/src/contract/draftAttachments.ts` offers `read`
  and `createReplacement` to other plugins without exposing the attachment store.

What a remote tree can draw is the closed list in `packages/protocol/src/tree/nodes.ts`. It includes
`Markdown`, `Table`, `CodeBlock`, `Graph`, `Rows`, and `DescriptionList`. It has no image, canvas, or
raw HTML node. Anything that owns pixels needs a rectangle.

## Proposed design

### One point that replaces the document

The editor registers a client point, `editor:document`, of kind `remote`, in `replace` mode, with
`max: 1`. `EditorPane` wraps its document area in a `Slot` for that point. CodeMirror and the
image preview become the slot's children, so they draw whenever no contributor matches, and the
terminal-mode branch stays outside the slot.

Props, in the editor's words:

| Prop | Why |
| --- | --- |
| `taskId`, `path` | Which file. The contributor passes both back when it asks its own node route for bytes. |
| `text` | The editor's live buffer for text files, so a preview follows typing without a read. Absent for binary files. |
| `revision` | A counter the editor bumps when the file changes on disk or the window regains focus. A contributor cannot see either event, and the image preview already rereads on focus for this reason. |

The editor draws a **Source** and **Preview** toggle outside the slot while `occupied` reports
`true`, so the reader can always get back to the text. A rendered view is read-only and never enters
the text pool or autosave, the same rule the image preview follows.

### A read-only file capability

A contributor cannot call the editor's routes. The host refuses a contribution that reads another
plugin's routes by construction. Text formats can live on the `text` prop. Binary formats need a way
to reach the bytes.

The editor provides a node capability, for example `editor.files` (new), with one method:
`read(taskId, path)`. It applies the same worktree confinement as the editor's own text and image
reads, caps the size, and returns bytes and a type. A contributor's node part declares the
capability, serves the bytes on its own route, and its tree or frame fetches them with
`bridge.api.getBytes`. This is the `agents.draftAttachments` pattern.

Two alternatives were considered and rejected:

- Share the existing `EDITOR` route bridge. It includes `write`, which no renderer needs.
- Grant loaded renderers the `fs` and `tasks` facets from
  `packages/node-core/src/server/plugins/coreFacets.ts`. Each plugin would re-implement worktree
  confinement, and the trust prompt would disclose "reads any file" for a markdown preview.

### Rectangles, when a renderer needs them

A PDF viewer or a Mermaid renderer needs an iframe. The editor would register a second point,
`editor:document-frame` (new), of kind `rectangle`, and place `InlineSlot` beside the `Slot`. Build
this only when the first plugin that needs it exists.

Rectangle locations are a closed list in `packages/protocol/src/chrome/extensionPoints.ts`, and
neither `pane.inline-beside` nor `pane.inline-below` describes "replaces the document". `InlineSlot`
does not check the location for a compiled owner, so it would work, but the honest change is a new
location name. The rule for that list is that it grows only when a surface draws the location, and
the editor would be that surface.

### Terminal host

Remote trees render in the terminal with the same kit nodes, so a markdown or CSV renderer works
there without extra code. A rectangle draws as one muted line naming the point, which matches what
the image preview does in the terminal.

## Decisions to make first

- **What the key is.** `matches` compares case-sensitively and supports only a prefix or suffix star.
  Keying by the lowercased basename lets `*.md`, `dockerfile`, and `package.json` all match, at the
  cost of directory patterns such as `.github/workflows/*.yml`. Keying by the full path keeps
  directories but misses a root-level `Dockerfile` with `*/dockerfile`. We recommend the lowercased
  basename.
- **Whether images move onto the point.** Keeping the image preview as the editor's built-in fallback
  costs nothing and needs no capability. Moving it would make it the first contributor. We recommend
  leaving it where it is.
- **Whether the toggle is remembered.** Per tab for the session is enough to start. A per-extension
  preference ("always open markdown as preview") can come later.
- **Side-by-side preview.** A preview next to the source is a different point, `editor:beside`, with a
  different layout. It is out of scope for the first version.

## Renderer catalogue

Each row is a candidate third-party plugin. "Tree" means a `remote` contribution built from kit
nodes. "Frame" means a rectangle. "Text" means the renderer reads the `text` prop. "Bytes" means it
reads through the file capability.

| Renderer | Files | Kind | Data | Terminal | Notes |
| --- | --- | --- | --- | --- | --- |
| Markdown preview | `*.md`, `*.mdx`, `*.markdown` | Tree | Text | Works | The first contributor to build. Uses the kit's `Markdown` node. MDX components render as their source. |
| CSV and TSV table | `*.csv`, `*.tsv` | Tree | Text | Works | `Table` node. Needs a row cap for large files, and a note of how many rows were left out. |
| Jupyter notebook | `*.ipynb` | Tree | Text | Works | Markdown cells through `Markdown`, code through `CodeBlock`, text outputs through `Log`. Image outputs need a frame or are skipped. |
| OpenAPI and JSON Schema | `openapi.*`, `*.schema.json` | Tree | Text | Works | Endpoint or field list built from `Rows` and `DescriptionList`. Matching `openapi.yaml` needs the basename key. |
| Lockfile summary | `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock` | Tree | Text | Works | Direct dependencies and versions, instead of thousands of lines in CodeMirror. |
| Generated or minified file | `*.min.js`, `*.min.css`, `*.map` | Tree | Text | Works | Size, line count, and a formatted excerpt, with the source one toggle away. |
| SVG | `*.svg` | Frame | Bytes | One line | SVG can carry scripts, which is why the built-in preview leaves it as text. Draw it as an `<img>` inside a sandboxed frame, or rasterise it. |
| Mermaid and Graphviz | `*.mmd`, `*.mermaid`, `*.dot`, `*.gv` | Frame | Text | One line | Needs the Mermaid or Graphviz library in the frame. Mermaid blocks inside markdown are a separate question for the markdown renderer. |
| PDF | `*.pdf` | Frame | Bytes | One line | PDF.js in the frame. Files over the 12 MiB bridge cap need paging or a streamed read, which the bridge does not offer. |
| HTML | `*.html`, `*.htm` | Frame | Text | One line | Sandboxed frame with scripts off by default. Overlaps with the preview pane, which serves a running app rather than a file. |
| Audio and video | `*.mp3`, `*.wav`, `*.ogg`, `*.mp4`, `*.webm`, `*.mov` | Frame | Bytes | One line | Native `<audio>` and `<video>` elements. Large media hits the bridge cap sooner than any other format. |
| SQLite database | `*.sqlite`, `*.db` | Tree | Bytes | Works | Table list and row preview. The database plugin is task-scoped and owns query running, so check what it already offers before building a second reader. |

## Verify before building

- Confirm `ctx.extensionPoints.register` on the client accepts a `remote` point from a compiled
  plugin that has no manifest, as `plugins/agents/src/client/index.ts` does, and that the point shows
  in **Settings > Plugins**.
- Check how the kit's `Markdown` node treats raw markdown and embedded HTML, and whether it resolves
  relative image links. A markdown preview that cannot show `./diagram.png` falls short of what
  people expect.
- Check whether large props crossing to a worker have a size limit. The `text` prop could be several
  megabytes for a large CSV.
- Confirm how `EditorPane` restores open tabs through its persisted state slice when a tab reopens on
  a rendered file, so the toggle state and the text prefetch skip agree.
- Recheck the rectangle location list and the manifest rules in
  `packages/client-core/src/host/frames/register.ts` before adding a location name.
- Paths here identify owners, not frozen APIs. Reread the cooperative extension point doc before
  starting.
