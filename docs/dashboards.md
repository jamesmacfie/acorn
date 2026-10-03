# Dashboards

Dashboards are published, typed projections over the Node's data sources and saved queries. Home is a
dashboard, and a plugin can reserve a region of its own surface for panels you compose. Read this page
for the execution path, persistence, and ownership, and for the topic pages. The client owns
composition and layout. It doesn't own source discovery, source schemas, query execution, or a second
record cache.

## Published panels

The dashboard editor builds a `DashboardPanelContent` draft from one or more saved or inline typed
queries. Publishing freezes those query references, the mapping, and the display rules in the Node's
dashboard library. A placed `PanelDefinition` holds only the publication ID and small indexing
metadata: `sources`, `fieldRoles`, and the view. The renderer resolves the publication and runs its
queries through the shared data-source runtime ([typed data sources](./data-sources.md)).

There's one execution path:

1. Resolve the dashboard publication in its workspace or project scope.
2. Resolve each saved or inline query, including typed parameter bindings.
3. Ask the Node data-source runtime to describe and query its source.
4. Project the typed records with `packages/dashboards-core`.
5. Draw the declared list, table, board, stat, or chart view.

A missing plugin, connection, publication, or field is an unavailable state, never an empty result or
a guessed schema. Source identity is `(pluginId, sourceId)`, and record identity and provenance belong
to the source contract.

## Persistence

Dashboard composition is the `dashboards` Node preference. Its envelope is version 1:

```json
{
  "version": 1,
  "panels": {
    "panel-id": {
      "id": "panel-id",
      "title": "Open pull requests",
      "publication": {
        "dashboardId": "dashboard-id",
        "sources": ["github:pulls"],
        "fieldRoles": ["status", "updated"]
      },
      "view": { "kind": "table" }
    }
  },
  "placements": { "home//workspace-id": ["panel-id"] },
  "layouts": { "home//workspace-id": { "panel-id": { "x": 0, "y": 0, "w": 6, "h": 4 } } }
}
```

Definitions are separate from placements, so one panel can appear on several surfaces with its own
geometry on each. An unknown placement owner or a missing panel ID stays inert, so a plugin that's
briefly unavailable doesn't destroy composition. A malformed definition is dropped, and an envelope
that isn't version 1 resets to the empty model (`packages/client-core/src/features/dashboards/persist.ts`).
A placement ID with no rect is normal: it renders in reading order.

Home tabs are placement scopes. Their names and order live in the same preference, at most eight per
workspace with names trimmed to 60 characters ([placements](./dashboards/placements.md)).

## Ownership

- `packages/protocol` owns the dashboard, query, and source wire schemas.
- Node core owns query and dashboard drafts, immutable revisions, publication, execution authority,
  sampling, and preferences.
- `packages/dashboards-core` owns the pure mapping, shaping, display, chart, trend, and measure rules.
  The files in `packages/client-core/src/features/dashboards/` named like them are one-line
  re-exports.
- Client core owns editor interaction, composition, placement, layout, and rendering.
- Plugins own source handlers and optional placement region declarations.

See also [data layer](./data-layer.md), [schedules](./schedules.md), and
[state ownership](./state-ownership.md).

## Pages

<a id="panels"></a>
<a id="the-two-vocabularies-and-the-budget"></a>
<a id="provenance-and-what-a-row-may-not-claim"></a>

- [Panels](./dashboards/panels.md) covers a panel's layers, the field vocabulary, provenance, and row
  actions.

<a id="views-are-derived-not-chosen-from-a-menu"></a>
<a id="trends-the-stat-that-earns-a-sparkline"></a>

- [Views and trends](./dashboards/views.md) covers which views a schema allows, charts, and stat
  trends.

<a id="the-mapping-layer-and-cross-source-panels"></a>
<a id="the-generated-editor"></a>
<a id="editor"></a>

- [Mapping and the editor](./dashboards/mapping-and-editor.md) covers cross-source panels and the
  editor.

<a id="placements"></a>
<a id="the-grid"></a>
<a id="placement-regions"></a>

- [Placements](./dashboards/placements.md) covers Home tabs, plugin regions, and the grid.

<a id="sampling-and-retention"></a>

- [Sampling and retention](./dashboards/sampling.md) covers the measure history behind a stat trend.
