# The extension example's trees

This page explains the client bundle of [the extension example](./extension-example.md),
[`src/client.tsx`](../../examples/plugins/acme-review/src/client.tsx): eight tree renderers in one file,
built with Vite into `dist/client.js`. It's part of
[plugin authoring](../plugin-authoring.md).

## How the trees behave

The bundle runs in a worker with no DOM. Each `mountTree` key is an entry a manifest `remote` names,
and the host mounts one tree per visible slot. All of them share the worker and its bridge. A tree
gets the point's props as a store, so a change of props redraws in place instead of remounting
([drawing a tree](./the-client-half.md#drawing-a-tree)).

- **Reads go to your own routes.** `bridge.api` reaches `/v1/p/acme-review/` with no scope, and refuses
  another plugin's namespace. A resource keyed on the props reads again when they change and keeps
  only the latest answer. Draw a fallback while it loads and when it fails.
- **Props are the owner's facts.** The pane gets `{ taskId, projectId }`, a tool card gets `{ tool,
  taskId, defaultOpen, fileChanges? }`, `editor:document` gets `{ taskId, path, text?, revision }`,
  and a fence viewer gets `{ blockId, language, text, revision }`. `plugin_authoring` lists every point's props.
- **Actions are requests.** `host.invoke('interrupt', ...)` runs only if the point declares the action
  and the owner bound it to this slot. Terminal refuses it with `needs_person` unless a person pressed
  inside this tree, and with `changed` when the session moved on, so draw the refusal
  ([toolbar actions](../plugins/toolbar-actions.md)).
- **Trees are one level deep.** A tree can't open a slot for a third plugin, and a loaded owner gets
  host-drawn regions with `mounts` instead ([detail regions](../plugins/detail-regions.md)).
- **The owner keeps its controls.** Editor keeps **Source**, Agents keeps an artifact's name and
  **Download**, and Linear keeps its own detail. When a tree fails, a `replace` point draws the
  owner's default instead.

Disposal is the host's: unmounting a slot ends its tree and runs `onCleanup`, so the pane's event
listener goes with it. Disabling the plugin or switching Node unmounts its trees, and so does
leaving the view a tree sat in.
