# File annotations

This page covers the marks other plugins put on Editor's file tree rows and document tabs, such as a
review note, a coverage gap, or a generated-file warning. It's part of [editor](../editor.md).

## The point

Editor opens `editor:file`, an [annotation](../plugins/rows-and-annotations.md#annotations) point
keyed `{ taskId, path }`. `path` is the case-preserving path relative to the task's worktree. Folders
are never keyed, because a folder summary would need its own meaning. The names live in
`plugins/editor/src/contract/fileAnnotations.ts`, and Editor registers the point in its client half.

A contributor declares an `items` extension on its own Node route:

```json
{ "id": "review-files", "point": "editor:file", "label": "Review", "items": "/v1/p/review/files" }
```

The host posts the files on screen and the route answers ordinary marks:

```text
POST /v1/p/review/files  { "keys": [{ "taskId": "…", "path": "src/auth.ts" }, …] }
→ { "items": [{ "key": { "taskId": "…", "path": "src/auth.ts" }, "severity": "warn", "text": "Needs review" }] }
```

The request carries no file text and no absolute path, and a mark grants nothing. A contributor that
needs the bytes declares and calls Editor's `editor.files` capability from its route
([file renderers](./file-renderers.md)). A mark keyed to another task, or to a path in another case,
lands nowhere.

## One batch per pane

Editor asks once per contributor for the open tabs and the tree's expanded files together. A file in
both is asked about once. No row or tab starts its own request, and no timer runs per file.

- Collapsing a folder removes its files from the batch. Expanding one adds them.
- The batch is every file row in an expanded folder, not only the rows scrolled into view. The shared
  host clears a contributor's marks whenever the key set changes, so asking per scrolled row would
  blank every mark on each scroll step. A tree with thousands of expanded files sends them all.
- Typing in a tab, saving, or switching to a plugin's preview doesn't change the keys, so it asks
  nothing new. A mark describes disk data from the contributor's side, not the unsaved buffer.
- A refresh follows the shared contract. A frame the contributor sends on its own channel
  (`ctx.events.send({ channel: 'plugin:<id>:<verb>' })`) or a plugin status change raises its
  freshness revision, and the host asks again. There is no per-file interval.
- A Node switch, a disable, or a removed contributor clears its marks in the same turn. A late answer
  for an old batch is dropped.

Each contributor keeps at most 256 marks per batch; the rest are dropped with a warning. The point
doesn't accept `detail`, so the host strips it from every mark. The shared
transport reads at most 4,096 raw rows and drops a malformed mark on its own.

## Drawing

Severity maps the same way on both hosts: `info` is muted, `warn` is warn, and `danger` is danger.

- **Tree rows.** Up to three glyphs sit after Git's status badge: the mark's icon on the desktop,
  otherwise a dot. The row's tooltip and accessible label list every mark as "text — plugin". The
  terminal draws dots and the same legend as muted text. Marks never select, open, or arm a row.
- **Tabs.** Up to three glyphs sit between Git's status letter and the unsaved dot. The tab's tip and
  accessible label list every mark. The terminal draws dots after the label and lists the active
  tab's marks after its Git status below the strip. The close control and the unsaved dot stay
  Editor's own.

Git's status (`editor:file-status`), [line markers](./line-markers.md), and
[line annotations](./line-annotations.md) are separate contracts and don't change.
