# The extension example's Node half

This page explains the Node half of [the extension example](./extension-example.md),
[`node.js`](../../examples/plugins/acme-review/node.js): one file with no imports that answers every
route the manifest names. It's part of
[plugin authoring](../plugin-authoring.md).

The host strips `/v1/p/acme-review` from every request, so `/v1/p/acme-review/add` arrives as `/add`.
The files under review are kept in memory, per task, so a restart empties them. A real plugin uses
`ctx.storage`. Every other answer is fixed data, so the example needs no network or account.

## What each route does

- **`/add`** is the `file.row` menu row's `runNodeAction`. The body is `{ resource: { kind: "file",
  taskId, projectId, path, directory, readOnly, revision? } }`, so the route learns which file and
  never its bytes. Sending on `plugin:acme-review:changed` makes Editor ask for marks again and the
  pane read the list again ([context menus](../plugins/menus-and-markers.md#context-menus)).
- **`/tools/files`** is the agent tool's handler. The host posts `{ arguments, origin }` and checks
  the caller's task before it calls you ([loaded tools](../agent-tools/loaded-tools.md#tool-handlers)).
- **`/marks`** answers one batch for every file Editor draws: the open tabs and the files in expanded
  folders. Return marks only for keys you know. The host keeps 256 and cuts text at 200 characters
  ([file annotations](../editor/file-annotations.md)).
- **`/artifact`** reads bytes through `agents.transcriptMedia`. Agents answers `null` unless the
  artifact belongs to the session and the session to the task, and `bytes` is `null` over 12 MiB
  ([transcript media viewers](../managed-agents/attachments.md#transcript-media-viewers)).
- **`/docs`** checks the host itself. Core fetches nothing for a preview, so your route owns the
  allowed hosts, redirects, size, and timeout ([link previews](../plugins/link-previews.md)).
- **`/issue`** answers for the item Linear's detail view shows. The region's props name the view and
  the item, never Linear's data ([detail regions](../plugins/detail-regions.md)).
- **`/hover`** and **`/diagnostics`** get the live buffer as `{ text, revision }`, and hover adds a
  one-based `position`. Echo `revision`, or the host drops the answer. A hover answers `null` where it
  has nothing to say ([hover and diagnostics](../editor/document-surface.md#hover-and-diagnostics)).

Every route is under `/v1/p/acme-review/`. The host refuses a manifest that names a route in another
plugin's namespace, and another plugin's tree can't call yours.
