# Dashboards

Dashboards are published, typed projections over the shared Node-owned data-source and query
contracts. The client owns composition and layout; it does not own source discovery, source schemas,
query execution, or a second record cache.

## Published panels

The dashboard editor builds a `DashboardPanelContent` draft from one or more saved or inline typed
queries. A publication freezes those query references, mapping, and display rules in the Node
dashboard library. A placed `PanelDefinition` contains only the publication ID and small indexing
metadata (`sources`, `fieldRoles`, and the view). The renderer resolves the immutable publication and
executes its queries through the shared data-source runtime.

There is one execution path:

1. Resolve the dashboard publication in its workspace or project scope.
2. Resolve each saved or inline query, including typed parameter bindings.
3. Ask the Node data-source runtime to describe and query its source.
4. Project the typed records with `dashboards-core`.
5. Render the declared list, table, board, stat, or chart view.

Missing plugins, connections, publications, or fields are unavailable states. They are never
silently replaced with an empty result or a guessed schema. Source identity is
`(pluginId, sourceId)`; record identity and provenance remain the source contract's responsibility.

A placed panel refetches when the Node announces a change to an account one of its queries read, or
any plugin change on that Node, because the plugin frame names only the Node. A panel that has no
data yet refetches on either change. It also refetches when the window regains focus, once its last
read is older than 30 seconds.

Pressing a row in a placed panel runs the record's declared action through `runChromeAction`, the
same dispatcher a rail row uses. An action whose `risk` is `write` or `execute` asks first, in a strip
above the rows. Rows in the editor's preview are not pressable.

## Editor

The editor uses the shared data controls for source choice, scope, parameters, predicates, sort,
and preview. Mapping and display configuration are pure `dashboards-core` projections. Publication
is the boundary between mutable authoring state and a panel that can be placed or sampled.
**Edit** on a placed panel runs **Refresh preview** once on open. A preview reads the source and
writes nothing to the draft.

Until workstream 2 replaces both with column IDs, `display.fields` and `display.groupBy` name the
panel's own fields (`title`, `status`, `assignee`, `updated`, `url`, and `source`) when the panel has
a mapping, and source JSON Pointers when it doesn't. A panel has a mapping when it has more than one
query, board columns, or a field or value mapping for any query. The schema enforces the rule, and the
editor drops references that stop fitting when a query is removed. Rows stored before the rule was
enforced are read the same way, so they never fail the library list.

**Validate** and **Publish** describe each query's source, project the panel over no records, and
refuse it when:

- A display field or the grouping isn't a field of the projected schema.
- The view kind isn't one `viewsForSchema` allows for that schema.
- A view option names a missing field or one of the wrong type: `field` needs a number, `x` needs an
  enum for a bar or a date for a line, and `series` needs an enum. A sum, average, minimum, or maximum
  without a `field` is refused too.
- A mapped role points at a pointer the source doesn't describe.

Each problem names its JSON Pointer path, such as `/display/groupBy`, and what to change. A query
that can't be resolved or described is reported at `/queries/<index>/reference`. The authoring route
runs the same check on every AI candidate.

The old flat panel form and client collection registry do not exist. Old definitions are rejected by
the versioned persistence parser and are recoverable only from the workflow-v2 transition export.

## Persistence

Dashboard composition is the `dashboards` Node preference. Its exact envelope is version 1 under
the verified `acorn-1` data root:

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

Definitions are independent from placements. A panel can appear on multiple surfaces with separate
geometry. Unknown placement owners and missing panel IDs remain inert so a temporarily unavailable
plugin or pane does not destroy composition. Malformed definitions are dropped; an unversioned or
non-v1 envelope resets to the empty model instead of invoking compatibility code.

Home tabs are placement scopes. Their names and order live in the same preference; panel content
still lives under ordinary placement and layout keys. Device-local editor recovery is temporary and
is cleared by the versioned development-state transition.

The Home tab header scrolls horizontally when the workspace has more tabs than fit. Its create button
stays visible, and selecting a tab brings it into view without wrapping the header.

## Placement regions

Plugin panel regions constrain publications by source ID, field role, and view kind. The check uses
the publication metadata only; it does not fetch records or inspect client caches. A region with no
constraint accepts any published panel. A constrained region rejects a publication whose metadata
cannot prove compatibility.

## Sampling and retention

The core `core:sample-measures` schedule runs in the Node with no client attached. For each placed
history-stat panel it resolves the immutable dashboard publication, resolves every query, invokes the
same Node data-source runtime, projects the panel, and appends the numeric measure. If any source is
unavailable, any read is neither `complete` nor `bounded`, or the projection has no finite measure,
that panel is skipped with a reason, such as "Issues returned partial data". No zero is invented and
no number is taken from partial data.

Samples are keyed by panel ID and a signature of the published measure definition: the projected
sources, the mapping, panel filters, the aggregate and its field, and for each query the published
revision digest of a saved query or the digest of inline content, its resolved parameters, and its
account. Republishing a saved query with a different filter therefore changes the signature. A
signature change resets that panel's series, and the pass counts the reset in its run result. Series
recorded before query identity joined the signature are relabelled on their next sample instead of
reset. The sampler is bounded per pass, and compaction removes series for
definitions that no longer exist.

## Ownership

- Protocol owns dashboard/query/source wire schemas.
- Node core owns query and dashboard drafts, immutable revisions, publication, execution authority,
  sampling, and preferences.
- `dashboards-core` owns pure mapping, shaping, display, chart, trend, and measure rules.
- Client core owns editor interaction, composition, placement, layout, and rendering.
- Plugins own source handlers and optional placement-region declarations.

See [Typed data sources](./data-sources.md), [Data layer](./data-layer.md),
[Schedules](./schedules.md), and [State ownership](./state-ownership.md).
