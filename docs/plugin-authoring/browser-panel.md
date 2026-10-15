# Browser panel

A plugin can add one read-only view to the extension's sidebar for the task the sidebar shows, such
as a local stack's state, links, services, and recent logs. The view is JSON from a route on your
Node half, drawn by the extension from a fixed set of blocks, so no plugin code runs in the browser.
Anything that changes state, such as restarting a service, stays in your pane in the desktop app,
which the panel's **Open in Acorn** opens. Runn is the first user.

Declare it in the manifest. The manifest also needs a `node` entry:

```json
{
  "contributions": {
    "browserPanel": { "label": "Runn", "glyph": "container", "pane": "runn", "route": "/v1/p/runn/browser-panel" }
  }
}
```

| Field | Meaning |
| --- | --- |
| `label` | The nav item's label and the panel's title, 1 to 40 characters. |
| `glyph` | A Lucide icon name for the nav item. Without one, the nav item shows a generic panel icon. |
| `pane` | A task-scoped pane in the same manifest, which **Open in Acorn** opens on the task. Without one, the task opens on whichever pane it showed last. |
| `route` | A `GET` route inside your own `/v1/p/<pluginId>/` namespace. |

Each plugin declares at most one panel. The manifest is refused when the route is outside your
namespace, when there is no `node` entry, or when `pane` names anything other than one of your
task-scoped panes.

A built-in plugin declares the same descriptor as `NodePlugin.browserPanel`. A built-in whose route is
outside its namespace fails the boot. Its Node half can't see its client panes, so nothing checks
`pane` for it. Add a test that `pane` matches the ID your client registers. Docker's and GitHub's
panels are the built-in examples.

## The panel route

The browser's native host calls `GET <route>?taskId=<id>` with a device credential. It adds
`&source=<id>` when the person has picked a log source. Each plugin decides whether to answer a
caller whose credential is bound to one task.

- For a task with no panel, answer 404. The extension then shows no nav item for that task.
- Otherwise, answer with a view: `{ blocks }`, at most 12 blocks.

| Block | Fields |
| --- | --- |
| `status` | `label`, `state`, `severity`, and an optional `detail`, shown as preformatted text |
| `links` | `title`, and `links`, at most 16, each `{ label, url }` with an optional `ready` |
| `rows` | `title`, and `rows`, at most 64, each `{ label, state, severity }` |
| `logs` | `title`, `sources`, at most 32, each `{ id, label }`, the `source` the lines came from or `null`, and `lines`, at most 200 |

Labels, titles, and states are 1 to 40 characters, and a row label can be up to 80. `detail` is at
most 2,000 characters, and a log line at most 1,000. A source ID matches
`^[a-z0-9][a-z0-9._-]{0,63}$`. `severity` is `info`, `warn`, or `danger`, as [task addresses](./browser-handoffs.md#task-addresses) use it,
or `pending` for a state on its way to healthy, such as a service that is still starting.
A link of any scheme is allowed. The extension opens only `http` and `https` links in a new tab, when
the person clicks the address, and offers every link to copy, so a database address is still useful.
Send `ready: false` for an address that isn't answering yet: the extension shows it but doesn't open it.

Parse your answer with `browserPanelView` from `@acorn/protocol/plugin/handoffs.ts`, the schema the
host applies. It is strict: an unknown field or block kind refuses the whole view, and so does an
answer over 512 KiB. The panel then shows an error and keeps the last view it had. A new block kind
has to ship in Acorn before a plugin can send it.

The extension draws everything as plain text, never as markup.

## When the panel is read

The extension never polls. It reads every declared panel when the sidebar's task changes, because
the answer also decides which nav items show. While a panel is open, it reads that panel again when:

- The Node's tasks change, which includes your plugin calling `ctx.events.status()`. Call it when
  your state changes, such as a stack going down.
- The connection to the Node comes back.
- The person picks a log source or clicks **Refresh**.

Every read runs your route, so keep it quick. Runn's runs `docker ps` and `docker logs`.

## Discovery

`GET /v1/core/browser-handoffs` lists each running plugin's panel under `panels`, beside its
[handoffs](./browser-handoffs.md#discovery-and-activation). A plugin that stops or is removed drops
out of the list, and its nav item with it. How the sidebar draws the panel is in
[plugin panels](../browser-extension/plugin-panels.md).
