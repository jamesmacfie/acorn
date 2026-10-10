# File renderers

This page covers how another plugin draws a file in the editor pane, such as a markdown preview or a
CSV table, and how its Node part reads the file's bytes. It's part of [editor](../editor.md).

## The document point

The editor declares one client point, `editor:document`, of kind `remote`, in `replace` mode, with
`max: 1`. The name and the prop type are `EDITOR_DOCUMENT_POINT` and `EditorDocumentProps` in
`packages/protocol/src/chrome/extensionPoints.ts`. `EditorPane` draws the `Slot` in a scrolling
column, and draws its own view, CodeMirror or the image preview, beside the slot whenever no
contributor stands in. The own view isn't the slot's default, because CodeMirror needs the whole box
and a contributor's tree needs the scroller. Terminal mode skips the point.

The key is the file's lowercased basename. `*.md`, `*.csv`, `dockerfile`, and `package.json` all
work as `matches` patterns. A directory pattern such as `.github/workflows/*.yml` doesn't match,
because the key has no directory. The key is only for matching. Props carry the real path.

| Prop | What it holds |
| --- | --- |
| `taskId`, `path` | The task and the worktree-relative path the editor reads. Pass both back to `editor.files` unchanged. |
| `text` | The editor's buffer for a UTF-8 text file, unsaved edits included. Absent for a binary file, an image, or a failed read. |
| `revision` | A counter that rises each time the editor hands the document over again. Work started for a lower revision is stale. |

The editor hands the document over when the tab opens on the preview, when the reader returns from
**Source**, when the window regains focus, and when the worktree changes. Each handover reads the
disk again unless the editor holds unsaved edits for the file, in which case it sends those edits.
Mount props have no size limit, so a large CSV crosses to the worker whole, once per handover.

When two contributors match one key, the editor's own view draws until the reader picks one in
**Settings > Plugins > Rail and surfaces**, as for every `replace` point.

## The Source toggle

While a contributor draws, the tab bar shows a **Preview** toggle, outside the slot, so a
contributor can't remove the way back to the text. Turning it off shows CodeMirror. The choice is per
tab for the session. It moves with a rename and is forgotten when the tab closes, the same as word
wrap and indentation. A tab that reopens later starts on the preview again.

A contributed view takes the box from CodeMirror the way terminal mode does. The view is torn down,
and the pooled document, its undo history, and any unsaved edits stay for the return. Leaving
CodeMirror blurs it, so a pending autosave runs at the switch, as it does on any blur. The preview
never writes, and it never replaces the buffer with the disk. While a contributor draws, the status
bar says **Read-only preview** and the send-to-agent and reload buttons are hidden.

## Reading bytes

A contributor can't call the editor's routes. A text format can use the `text` prop. A binary format
reads through `editor.files`, a Node capability in `plugins/editor/src/contract/files.ts`:

```ts
read({ taskId, path }): Promise<
  | { status: 'ok'; bytes: Uint8Array; revision: string }
  | { status: 'missing' }
  | { status: 'too_large'; byteSize: number }
>
```

The read uses the same worktree and symlink confinement as the editor's text and image routes, and
works out the worktree again on every call. A task with no worktree, a path outside it, a directory,
and an absent file all answer `missing`, so the answer never says what exists outside the worktree.
Files over 12 MiB answer `too_large`. That limit is `MAX_PLUGIN_BYTES`, the binary bridge's cap. The
revision is the same SHA-256 the text route returns for the same bytes.

The read returns the bytes on disk. Unsaved edits reach a renderer only through `text`.

A loaded renderer declares `requires.plugins: [{ id: "editor" }]` and `editor.files` in
`permissions.node.capabilities`, serves the bytes on one of its own routes, and fetches them from its
tree with `bridge.api.getBytes`. A compiled renderer resolves `EDITOR_FILES` at call time. A loaded
plugin types the call with `CapabilityIdOf<'editor.files'>` from `@acorn/plugin-types`.

A loaded renderer's manifest entry:

```json
{ "id": "markdown-preview", "point": "editor:document", "label": "Markdown preview",
  "remote": "preview", "matches": ["*.md", "*.markdown"] }
```

A compiled renderer registers the same thing with
`ctx.extensions.register({ point: 'editor:document', matches, component })`.

## Terminal client

Remote trees draw with the same kit nodes in the terminal client, so a markdown or table renderer
works there without extra code. The terminal client has no CodeMirror, so the `text` prop always
comes from a disk read there.

## Limits

- The point is a tree, not a rectangle. A renderer that owns pixels, such as PDF, SVG, Mermaid, or
  media, has no place to draw. A rectangle point needs a location name beside `pane.inline-beside`
  in `packages/protocol/src/chrome/extensionPoints.ts`. It waits for the first renderer that needs it.
- The preview replaces the source. A side-by-side view would be a separate point.
- The Source choice isn't remembered across sessions or per file type.
- Files over 12 MiB can't reach a renderer as bytes, because the bridge has no paged or streamed read.
