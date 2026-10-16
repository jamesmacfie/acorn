# Plugin panels in the browser extension

This page covers plugin panels in the [browser extension](../browser-extension.md): a plugin's
read-only view of the sidebar's task, its tab, and the operation that reads it. The code is in
`apps/extension/src/sidebar/PluginPanel.tsx`, `apps/extension/src/sidebar/Workspace.tsx`,
`apps/extension/src/sidebar/App.tsx`, and `apps/cli/src/browser/bridge.ts`. How a plugin declares
and serves a panel is in [browser panel](../plugin-authoring/browser-panel.md).

## The tab

`handoffs.list` carries the Node's declared panels, without their routes. When the sidebar opens
another task, it reads every declared panel for that task.

A plugin whose route answers a view gets a tab under the task, after **Agents** and **Runs**, with
its label and glyph. A plugin that answers 404 has no panel for the task, and no tab. An open panel's
tab stays while its view loads. An open panel gives way to **Agents** when the task has no panel or
the plugin stops. A page that belongs to no task leaves it open.

## The panel

The panel draws the plugin's blocks with the kit's parts, as plain text. A block's severity picks an
icon and a tone in one table, `SEVERITY` in `PluginPanel.tsx`:

| Severity | Icon | Tone |
| --- | --- | --- |
| `info` | `circle-check` | ok |
| `warn` | `circle-alert` | warn |
| `danger` | `circle-x` | danger |
| `pending` | `circle-dashed` | muted |

A panel has no "ok" severity. A plugin sends `info` for a passing check or an approving review.

- The view's first block, when it's a `status` block, is the header: the label in large type and the
  state as a `Badge` in the severity's tone. Each line of `detail` follows. The first line is bold, a
  second line that holds "→" is monospace, and the rest are muted. That reads the GitHub plugin's
  lines out of free text, and an optional field on the block would replace it.
- A later `status` block is a row with its severity's icon, its state at the right, and its detail as
  the row's tip.
- `rows` is a section with its title and count, and a kit `Row` for each row: the severity's icon,
  the label, and the state at the right.
- `links` is a section of rows, each with a link icon, the label, and the address under it without
  `https://` or `http://`. Every row has a **Copy** icon button, which shows a check for a moment
  after copying. An `http` or `https` address without `ready: false` makes the whole row a link that
  opens in a new tab, with a faint arrow at the right. Any other address opens nothing.
- `logs` is a section with the source in a ghost `Picker` in its header and the lines in the kit's
  `Log`. Picking a source reads the panel again with that source, which the sidebar remembers for the
  plugin until it closes.

**Refresh** and **Open in Acorn** are icon buttons at the right of the header, drawn even when the
view has no `status` block first. **Refresh** turns while a read it started, or the first read, is
out. **Open in Acorn** opens the task in the desktop app on the plugin's declared pane. Anything that
changes state happens there.

While the header's severity is `danger`, the panel's tab carries a red `circle-x`, named "Needs
attention".

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

- Only the extension draws a panel. The desktop and the terminal client have no view of
  `browserPanelView`, so the drawing isn't shared with them, though every part it uses is a kit part
  both of them have.
- The nav item, the panel, and the operation were checked in unit tests only, not in a browser against
  a Node running a plugin with a panel.
- Changing the sidebar's task reads every declared panel, even when none is open, because the answer
  also decides which nav items show. A slow route slows every task change.
- An answer past the size limit reads as the Node not answering, not as the plugin's fault.
