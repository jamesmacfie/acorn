# Dashboards

Dashboards are published, typed projections over the Node's data sources and saved queries. Home is a
dashboard, and a plugin can reserve a region of its own surface for panels you compose. Read this page
for the execution path, persistence, and ownership, and for the topic pages. The client owns
composition and layout. It doesn't own source discovery, source schemas, query execution, or a second
record cache.

## Published panels

The dashboard editor builds a version 2 `PanelPlan` from saved or inline typed queries. Its columns
bind source fields into panel-owned values. Filter, compute, summarize, expand, and overlap stages,
sorting, grouping, limits, view options,
and a time policy operate on those values. The Node stores drafts and immutable published revisions.
A placed `PanelDefinition` carries the publication ID and derived indexing metadata (`sources`,
`fieldRoles`, and the view).

There is one execution path:

1. Resolve the dashboard publication in its workspace or project scope.
2. Resolve each saved or inline query, including typed parameter bindings.
3. Ask the Node data-source runtime to describe each source and validate column bindings.
4. Plan and share authorized reads, query each source, and run the plan on the Node.
5. Render the declared list, table, board, stat, or chart view.

Primary sources contribute rows. A declared lookup attaches fields, and a declared children relation
attaches a bounded list. Only equivalence merges two primary records into one row; the merged row
retains both references and uses each column's declared source precedence. Relation keys match exact
typed values and must include provider, account, and identity scope, plus a container when the source
requires one. A missing lookup keeps its primary row unless the plan explicitly drops it. Cardinality
violations warn with the relation and key and never multiply rows.

A plan has at most eight ordered stages, three summaries, and one overlap. Summaries group by up to
three columns and can calculate filtered counts, sums, averages, extrema, median, percentiles,
distinct counts or lists, and earliest or latest values. Measures can be shares of their total;
time buckets can fill gaps and show previous-bucket changes; an enum can pivot a measure. A compute
stage uses a closed, typed expression set. Expand and overlap carry row and pair limits. Stage
diagnostics report both row counts and what one row means after each step. An incomplete source or
unknown measure input marks the affected measure partial, with a reason; mixed per-row units fail
the measure rather than making an invented total. The history sampler skips a run with partial
measures or a failed relation. Summary cells retain the exact contributing rows
for read-only drill-down at the original evaluation instant.

Missing plugins, connections, publications, or fields are unavailable states. They are never
silently replaced with an empty result or a guessed schema. Source identity is
`(pluginId, sourceId)`; record identity and provenance remain the source contract's responsibility.

A placed panel caches a Node run by Node, scope, panel, revision, and viewer time zone. It refetches
after a reported account or plugin changes, when the window regains focus, and at the plan's refresh
interval. The Node shares identical authorized reads briefly across panels.

The plan can choose a row press destination and up to three trailing buttons. Runs keep full source
record references, including account and scope. A row menu offers the same actions from the keyboard.
Group headers and stat measures open their underlying rows in a read-only side panel; **Add as panel**
publishes the derived plan. See [panels](./dashboards/panels.md#provenance-and-what-a-row-may-not-claim).

`POST /v1/core/dashboards/run` accepts a scoped published revision or a draft `PanelPlan`, `preview`
or `execution` mode, and an optional viewer time zone. It returns the resolved plan, rows, groups,
plain-language description, and diagnostics for sources, stages, and budgets. Dashboard authoring's
`list-accounts` metadata operation returns account IDs, provider IDs, and display names without
reading provider records.

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
