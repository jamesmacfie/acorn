# Dashboards

Dashboards are published, typed projections over the shared Node-owned data-source and query
contracts. The client owns composition and layout; it does not own source discovery, source schemas,
query execution, or a second record cache.

## Published panels

The dashboard editor builds a version 2 `PanelPlan` from saved or inline typed queries. Its columns
bind source fields into panel-owned values. Filter stages, sorting, grouping, limits, view options,
and a time policy operate on those values. The Node stores drafts and immutable published revisions.
A placed `PanelDefinition` carries the publication ID and derived indexing metadata (`sources`,
`fieldRoles`, and the view).

There is one execution path:

1. Resolve the dashboard publication in its workspace or project scope.
2. Resolve each saved or inline query, including typed parameter bindings.
3. Ask the Node data-source runtime to describe each source and validate column bindings.
4. Plan and share authorized reads, query each source, and run the plan on the Node.
5. Render the declared list, table, board, stat, or chart view.

Missing plugins, connections, publications, or fields are unavailable states. They are never
silently replaced with an empty result or a guessed schema. Source identity is
`(pluginId, sourceId)`; record identity and provenance remain the source contract's responsibility.

A placed panel caches a Node run by Node, scope, panel, revision, and viewer time zone. It refetches
after a reported account or plugin changes, when the window regains focus, and at the plan's refresh
interval. The Node shares identical authorized reads briefly across panels.

Pressing a row in a placed panel runs the record's declared action through `runChromeAction`, the
same dispatcher a rail row uses. An action whose `risk` is `write` or `execute` asks first, in a strip
above the rows. Rows in the editor's preview are not pressable.

## Editor

**Add panel** starts with **Pick data** or **Describe it**. The source picker shows source and account
pairs; the AI conversation asks for missing choices and proposes the same plan used by the forms.
The editor shows columns, filter stages, view options, the host's plan description, and a live Node
preview. Source descriptions may offer starter plans, which the host validates before showing them.
Each change autosaves the draft and a device recovery copy.

`PanelPlan` version 2 permits primary sources and `filter` stages. The closed capability list in
`dashboards-core/capabilities.ts` defines the available operations and view options. Columns can
inherit choice tones and ranks, display lists as chips, and carry fixed or per-row units. The time
policy stores an IANA zone, fixed or viewer display mode, and week start. Calendar days stay calendar
days. Validation reports JSON Pointer paths for missing or retyped bindings, incompatible operations,
sorts, groups, and view fields. A run leaves a changed column unavailable and reports a rebind notice;
new enum values appear in an unmatched-value notice.

The Node pushes supported filters to source queries only when their semantics match. It applies a
source's own limit before panel filters, and warns when that order could hide rows. A final sort and
limit may become a source `take` when no later stage changes the result. Per-provider scheduling,
rate-limit backoff, and record, time, intermediate-row, and byte budgets bound reads. The sampler
uses the same Node runner and the plan's stored time policy.

Version 1 panels read through a pure upgrade with a fixed UTC policy. Saving a draft writes version
2. Stored published version 1 bytes and digests remain unchanged.

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
