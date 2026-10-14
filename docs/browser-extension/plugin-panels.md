# Plugin panels in the browser extension

This page covers plugin panels in the [browser extension](../browser-extension.md): a plugin's
read-only view of the sidebar's task, its nav item, and the operation that reads it. The code is in
`apps/extension/src/sidebar/PluginPanel.tsx`, `apps/extension/src/sidebar/Workspace.tsx`,
`apps/extension/src/sidebar/App.tsx`, and `apps/cli/src/browser/bridge.ts`. How a plugin declares
and serves a panel is in [browser panel](../plugin-authoring/browser-panel.md).

## The nav item

`handoffs.list` carries the Node's declared panels, without their routes. When the task the Agents
tab shows changes, the sidebar reads every declared panel for it. That task is the page's own, or
the current task on its project's site.

A plugin whose route answers a view gets a nav item after **Workflows** and before **Settings**,
with its label and glyph. A plugin that answers 404 has no panel for the task, and no nav item. An
open panel's nav item stays while it is open, and says the task has no panel when that is so. A
panel whose plugin stops closes to Home.

## The panel

The panel draws the plugin's blocks with the kit's rows and section headers, as plain text:

- `status` is a state line, with its detail as preformatted text.
- `links` lists each link with **Copy**, and **Open** for an `http` or `https` address only, which
  opens in a new tab.
- `rows` lists each row with its state dot.
- `logs` has a source picker and the lines. Picking a source reads the panel again with that
  source, which the sidebar remembers for the plugin until it closes.

**Open in Acorn** opens the task in the desktop app on the plugin's declared pane. Anything that
changes state happens there.

An open panel is read again when the Node's tasks change, which includes the plugin reporting a new
state, when the connection comes back, and on **Refresh**. A failed read keeps the last view and
shows why above it.

## Native operation

| Operation | Fields | Result |
| --- | --- | --- |
| `plugin.panel` | `nodeId`, `pluginId`, `taskId`, `source` (optional) | `{ nodeId, pluginId, taskId, view }` |

The host looks the plugin's panel up in the Node's discovery for every call, so the browser never
names a route, and it calls only a route inside the plugin's own namespace. It sends the task ID and
the source ID, and no page address.

`view` is null when the plugin declares no panel or its route answers 404. The host reads at most
512 KiB and holds the answer to `browserPanelView`. An answer that fails the schema fails with
`node_error`: "The <id> plugin answered with something the extension can't use." An answer past the
size limit fails as an unanswered read, with `node_unreachable`.

When a plugin that declares a panel sends `term:status`, the host sends the `tasks` event, as it does
for a plugin with task addresses. The sidebar's task list is read again, and an open panel with it.

## Gaps

- The nav item, the panel, and the operation were checked in unit tests only, not in a browser against
  a Node running a plugin with a panel.
- Changing the sidebar's task reads every declared panel, even when none is open, because the answer
  also decides which nav items show. A slow route slows every task change.
- An answer past the size limit reads as the Node not answering, not as the plugin's fault.
