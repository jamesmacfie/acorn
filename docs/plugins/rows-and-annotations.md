# Rows and annotations

This page covers the two descriptor kinds of [cooperative extension point](./cooperative-extension-points.md):
rows, a list under another plugin's pane, and annotations, marks on items another plugin draws. Both
are records the host draws, with no plugin code on the client. It's part of the
[plugin reference](../plugins.md).

## Rows

Plugin A declares the point it hosts. This one entry is all the code A writes:

```json
{ "contributions": {
  "frames": [{ "target": "pane", "id": "board", "label": "Board", "layout": "single", "regions": { "body": "frame" } }],
  "extensionPoints": [{ "id": "card-links", "kind": "rows", "label": "Linked items", "location": "pane.footer", "surface": "board" }]
} }
```

`location` is a closed list, and it grows only when a surface exists to draw it:

- `pane.footer` is a strip the host draws under a plugin pane's frame.
- `pane.aside` is a column beside it.
- `pane.inline-below` and `pane.inline-beside` hold another plugin's rectangle
  ([rectangles](./remote-points.md#rectangles)).

`surface` must be a `pane` the same manifest declares. Settings pages, importers, overlays, reference
panels, and webviews have no room to reserve a strip. One pane may have several points, one per
location.

A footer is filled by other plugins' `extensions`. An aside is filled by the person: the host draws a
dashboard region, and the owner declares the constraints the person's composition must meet, as
`panels: { sources | fieldRole, views, max }`. It defaults to this plugin's own data sources, every
view, and four panels ([placements](../dashboards/placements.md)). An `extensions` entry aimed at an
aside delivers nothing.

The host draws every region, and the plugin's layout only reserves room for it.

Plugin B declares what it puts there, by id:

```json
{ "contributions": { "extensions": [{
  "id": "board-issues",
  "point": "board:card-links",
  "label": "Linear issues",
  "items": "/v1/p/tracker/board-issues",
  "onSelect": { "verb": "runNodeAction", "path": "/v1/p/tracker/open" }
}] } }
```

`point` is `<ownerPluginId>:<pointId>`, so B's manifest names A, and an owner reading it at install
can see which package this one reaches into. `items` is a GET on B's own namespace answering
`{ items: [{ id, title, subtitle?, icon?, badge? }] }`, display strings only. `onSelect` is declared
once, from the narrow verb set, so the Node can check it at parse time. The clicked row's id is passed
as the item. There's no per-item action, because that would be an unchecked verb arriving over a
route.

An extension names exactly one carrier: `items`, `remote`, `frame`, or `route`. The right one depends
on the owner's kind, which the contributor's manifest can't see. The Node checks that there's exactly
one, and the match between carrier and kind happens at delivery.

## Annotations

Rows answer "what's related to this pane". Annotations answer "what do you know about this line". The
owner declares what its items are keyed by, and the contributor answers with marks for the keys on
screen:

```json
// A: changes declares what can be annotated
{ "id": "diff-line", "kind": "annotation", "label": "Diff line",
  "key": { "file": "string", "line": "number", "side": "string" } }

// B: coverage
{ "id": "coverage-lines", "point": "changes:diff-line", "label": "Coverage",
  "items": "/v1/p/coverage/lines" }
```

The host posts the visible keys to each contributor in one request, and B answers with marks:

```text
POST /v1/p/coverage/lines  { "keys": [{ "file": "src/auth.ts", "line": 42, "side": "new" }, …] }
→ { "items": [{ "key": {…}, "severity": "info" | "warn" | "danger", "text": "Not covered by any test", "icon": "shield-off" }] }
```

A mark holds scalar key fields, one of three severities, up to 200 characters of text, and an
optional host-resolved icon. It holds no markup, CSS, geometry, color, or action. The host builds the
lookup from the owner's declared fields in the owner's order, so a contributor can't widen its match
by inventing a field. The host stamps provenance on every mark.

Annotation state belongs to one contributor at one point. Its request identity includes the point and
contributor registrations, the active Node, the plugin's chrome revision, and the visible-key
signature. A changed identity aborts the previous read and removes that contributor's marks in the
same turn. A late response can't restore stale marks, even when the contributor ignores its
`AbortSignal`. The host merges contributors in registered order, not response order. A failed
contributor stays empty and leaves the others' marks alone. Reload, disable, removal, and Node
changes clear the state before replacement registrations can reuse ids.

The transport reads at most 4,096 raw rows from one response, drops malformed rows one at a time, and
reports one overflow summary past that ceiling. A point owner may set a smaller accepted-mark limit.

### Task annotations

`core:task` is the core-owned annotation point for loaded-plugin task status. Its key is
`{ "task": "<task-id>" }`. A contributor declares an `items` extension and serves the ordinary batched
POST. The host makes one request per contributor and visible task-id set, with no request, timer, or
subscription per task row. [Add task annotations](../plugin-authoring/extensions.md#add-task-annotations)
has a complete example.

`core:task` accepts at most 256 valid marks from one contributor per request. The desktop turns
accepted marks into rail markers: severity chooses the tone, the optional icon is resolved by the
host, and a missing icon becomes a status dot. The desktop still has only four corners, and every mark
stays in the ordered tooltip legend and the accessible description. The terminal uses the same
legend ([rail controls and status markers](../ui-design.md#rail-controls-and-status-markers),
[task markers](../tui/chrome.md#task-markers)).

This path is task-only. A plugin that needs source or pane status needs an owner-declared annotation
point for that surface first, not a rail-specific manifest key.

### Storage and memory sections

`core:storage` is the core-owned `remote` point on **Settings > Storage and memory**, in `stack` mode
with room for four. A plugin that holds memory or disk on the Node draws its own section there and
reads its numbers from its own route. The contributor is mounted with `nodeId`, the Node the page
shows. Core declares the point where the page is drawn
(`client-core/features/settings/StorageSettings.tsx`) and never calls a plugin's route. The agents
plugin is the one contributor, with a compiled component.
