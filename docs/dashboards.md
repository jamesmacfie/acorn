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
for read-only drill-down at the original evaluation instant. Adding a bucket drill-down as a panel
stores its exact calendar range, including the selected time zone's offset changes.

Missing plugins, connections, publications, or fields are unavailable states. They are never
silently replaced with an empty result or a guessed schema. Source identity is
`(pluginId, sourceId)`; record identity and provenance remain the source contract's responsibility.

A run reports a source that couldn't answer, or answered in part, as a problem with a `failure`: the
data source error code, or `incomplete` with its cause, the `plugin:source` id, and the input at
fault. `message` keeps the Node's wording for older clients. `features/dashboards/sourceErrors.ts`
turns a failure into a sentence and a fix, such as "Pull requests needs a GitHub account." with
**Choose an account**, or "Northwind is waiting for you to approve what it reads." with **Review**.
A failure with no sentence of its own adds the source's `reason`, so a GitHub panel blocked by an
organisation's single sign-on says so in the pull list's words (`github/src/shared/readFailures.ts`).
The studio, the placed panel, and the source picker all use it, so none shows a code or a JSON
pointer. Every fix is host UI, because a loaded plugin can't open Settings. **Review** and **Turn it
on** open the plugin's page, **Reconnect…** opens the account's page, **Choose an account** opens the
studio, and **Try again** runs the panel again. When a source fails after the panel has shown data,
the panel keeps the last data on screen, greyed out and inert, under the message.

A placed panel caches a Node run by Node, scope, panel, revision, and viewer time zone. It refetches
after a reported account or plugin changes, when the window regains focus, and at the plan's refresh
interval. The Node shares identical authorized reads briefly across panels.

The plan can choose a row press destination and up to three trailing buttons. Runs keep full source
record references, including account and scope. A row menu offers the same actions from the keyboard.
Group headers and stat measures open their underlying rows in a read-only side panel; **Add as panel**
publishes the derived plan, with its own sources and field roles, and a toast offers **Edit…**. See
[panels](./dashboards/panels.md#provenance-and-what-a-row-may-not-claim).

The panel menu renames a panel, switches its view, and changes its sort without the studio. Each of
these quick edits publishes a revision, and refuses while the panel has unpublished studio edits.
**About this panel** shows what a panel does without opening an editor. See
[placements](./dashboards/placements.md#the-panel-menu).

An enum choice can store one write value for each bound source. The column editor lists only values
that the source declares writable. Dragging a board card to a choice, or choosing **Move to** in its
row menu, uses that value. The host asks for confirmation before a risky change, moves the card while
the request runs, and refreshes after success. Cancellation sends no request. A missing mapping,
merged or summary row, changed source eligibility, or failed write shows a source-specific reason;
a failed move returns the card to its previous column. Panel movement still starts from the panel
header, leaving the card body for its own gesture.

`POST /v1/core/dashboards/run` accepts a scoped published revision or a draft `PanelPlan`, `preview`
or `execution` mode, and an optional viewer time zone. It returns the resolved plan, rows, groups,
plain-language description, and diagnostics for sources, stages, and budgets. Dashboard authoring's
`list-accounts` metadata operation returns account IDs, provider IDs, and display names without
reading provider records.

## Datasets and history

**Keep history** in the editor creates a workspace-scoped or project-scoped dataset from a query and
asks the owner to approve a capture cadence. The owner chooses one immutable storage mode: **latest
state** upserts an identity and marks missing records removed after a complete capture; **every
event** retains stable event identities and arrival times; **daily snapshots** stores each identity
at each capture time. A different mode needs a new dataset. The new dataset appears in Pick data as
a core source. Settings → Datasets shows its feeder, size, 90-day default retention, caps, and
coverage, and permits deletion.

An event archive claims completeness only for source-proved or checkpoint-proved windows. Capture
failures, schema mismatches, and uncovered windows remain visible as gaps. Dataset panels carry
coverage labels and mark affected summaries partial. A dataset summary applies preceding filters and
groups in Node SQLite, returning at most 5,000 summary rows; the panel asks separately for up to
1,000 underlying rows when a person drills into a measure. Live provider summaries continue through
the in-memory runner. Stat measure history remains in its existing table and keeps its sampling and
retention behavior.

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
