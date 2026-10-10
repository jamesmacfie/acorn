# Markdown fences

This page covers `core:markdown-fence`, the point that lets a plugin draw a code fence in Markdown the
host renders, such as a JSON block in an agent's reply drawn as a table. Read it before you fill the
point or let a new surface offer it. It's part of the [plugin reference](../plugins.md), beside
[remote points](./remote-points.md).

## What it does

Core owns the point. It's `remote` and `replace`, and its key is the fence's language hint in
lowercase, so ` ```JSON ` and ` ```json ` both match `json`. No alias is mapped: `yml` and `yaml` are
two keys. A contributor declares the hints it draws:

```json
{ "id": "json-table", "point": "core:markdown-fence", "label": "JSON table",
  "matches": ["json"], "remote": "jsonTable" }
```

Its tree gets `{ blockId, language, text, revision, taskId?, projectId? }`. `language` is the hint as
written. `text` is the fence's source without its opening and closing lines. Only a closed fence with
a hint and at most 256 KiB of text in UTF-8 gets a viewer. A fence that's still streaming, has no
hint, or is too large is drawn as source, and no worker starts for it.

`blockId` names the fence's block for as long as the block lives. A fence whose text changes is a new
block: the host disposes the old viewer and mounts a new one with a new `blockId`, so a viewer never
draws text it wasn't given. `revision` is how many texts the Markdown had rendered when the block
appeared, so a later block in the same message has a higher one. `taskId` and `projectId` are the
content's own, and also the tree's scope for `openPane` and in-app links.

The owner keeps the controls. On the desktop, a **Preview** toggle sits beside the fence's copy button,
both outside the viewer, and the source stays in the page while hidden. The terminal draws **Source**
or **Preview**, **Copy**, and the hint and plugin on a line above the fence, and clips a viewer at 20
rows. Copy always copies the source.

Each content owner opens at most four viewers: an agent message, or one `Markdown` node in a pane. The
first four fences somebody can draw open on their own. Later ones stay source with **Preview**, which
sends the earliest open fence back to source. The choices last until the owner unmounts and are never
stored. A tie with no pick, a tree that fails, or a contributor that goes away leaves the source.

## Who offers it

- Agent transcripts: message text, reasoning, and plan entries, through `ManagedAgentMarkdown.tsx`.
- A loaded plugin's pane: its own `Markdown` nodes. `register.ts` mounts pane regions with
  `markdownFences: true`.

A tree drawn in another owner's slot doesn't offer it. Its `Markdown` keeps plain fences, because
cooperative points are one level deep. That includes an `editor:document` viewer that draws Markdown,
a tool card, and a fence viewer's own tree. A worker can't pass `fences` itself: the tree host
replaces the prop on every `Markdown` node. Provider HTML, such as a pull request body, doesn't offer
it either, because the host can't tell where its fences began.

A viewer that needs pixels draws a summary from kit nodes and opens its declared
[companion overlay](./remote-points.md#companion-overlays) for the full view. There's no inline iframe.
On the terminal, which has no overlays, keep the summary up.

## How the host draws it

| Piece | Owner |
| --- | --- |
| Fence blocks with their hint and source | `client-core/src/kit/lib/rendering/markdown.ts`, `renderBlocks` |
| The adapter a host passes to `Markdown`'s `fences` | `MarkdownFenceAdapter`, same file |
| Hiding the source and placing the view in `.ui-code-wrap` | `kit/components/content/Markdown.tsx` |
| The point, block identity, the cap, Source/Preview | `client-core/src/host/markdownFences/fenceViewers.ts` |
| The desktop toggle and `Slot` | `host/markdownFences/MarkdownFences.tsx` |
| The terminal line, blocks in cells | `apps/tui/src/kit/host.tsx`, `apps/tui/src/kit/showing/documents.tsx` |
| Which trees may offer it | `markdownFences` on `RemoteTree` and both `TreeHost`s |

The fence's wrapper keeps `.ui-code-wrap` and `data-language`, so a
[selection action](./menus-and-markers.md#context-menus) in a viewer still reads as code in that
language.

To offer viewers in a new host-owned surface, call `markdownFences({ taskId, projectId })` from
`@acorn/plugin-api/ui/host` once in the component that owns the content, and pass the result to
`Markdown` as `fences`. Each call is one owner for the cap.
