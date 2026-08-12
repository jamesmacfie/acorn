# Prior art: how others solved "plugins provide typed data, users compose visualizations"

Design notes from the dashboards session (2026-08-12). Nothing here is scheduled. This is the
external research pass, kept as reference so the reasoning behind the contract choices in
`data-contract.md` and `composition.md` survives. Sources: Perses public docs and repo, Glance
repo; the rest from working knowledge of each system's public docs and source as of the session
date — re-verify specifics before leaning on them for implementation detail.

## Grafana — the most complete reference implementation

Three plugin kinds; the two that matter are **data source plugins** (implement
`query(request) → DataQueryResponse`, ship their own query editor, because only the source knows
what PromQL vs SQL looks like) and **panel plugins** (a React component receiving
`{ data, options, fieldConfig, timeRange, width, height }`). The two never import each other; they
meet at the DataFrame.

**The data contract: DataFrame.** A column-oriented table: `fields[]`, each field with a `name`, a
`type` from a small closed enum (`time | number | string | boolean | enum | geo | trace | other`),
`values`, and — crucially — `FieldConfig`: display metadata (unit, decimals, min/max, thresholds,
value mappings, links, color mode) attached to the *field*, not the panel.

**Why DataFrame won over bespoke shapes.** Before Grafana 7, sources returned one of two bespoke
shapes (`TimeSeries`, `TableData`); every panel special-cased both, and new domains (logs, traces,
node graphs) fit neither. DataFrame collapsed the M sources × N panels compatibility matrix into
M + N adapters, and generic machinery (transformations, field overrides, CSV export) got written
once against frames instead of per panel.

**Queries** are a `targets[]` array per panel; each target has a `refId` ("A", "B", …), a
datasource reference, and otherwise opaque source-specific properties. `refId` is the indirection
that lets transformations and alerting refer to a query without knowing its shape.

**Transformations** are an ordered, declarative pipeline of frame→frame steps (filter, organize,
group by, join, calculate) applied after query, before render — user-composed reshaping lives
here, so neither sources nor panels implement filtering/grouping.

**Panel options** use a typed options-builder DSL producing the persisted schema *and* the
auto-generated editor from one declaration. `fieldConfig` has `defaults` + `overrides` (matcher +
property patches); the panel-options/field-config split matters because field config describes the
data ("this column is milliseconds, red above 500") and survives panel-type switches.

**Dashboard JSON model**: `panels[]` with `gridPos`, `targets[]`, `transformations[]`,
`fieldConfig`, `options`; dashboard-level variables and refresh interval. The model carries a
`schemaVersion` with dozens of in-app migrations accreted over a decade — and Grafana is currently
rebuilding the whole model (Scenes / schema v2) to escape it.

**Steal:** the neutral column-typed interchange with display metadata on fields; schema-in-response.
**Avoid:** letting the persisted dashboard model grow organically — version it from day one.

## Home Assistant Lovelace — entities as the typed layer

The universal record is the **entity**: an id, a `state` (always a string), and an attributes
dict. Types are layered on gently: domain (`sensor`, `switch`) plus `device_class` (temperature,
battery, …), `state_class`, `unit_of_measurement` — and these drive default icons, formatting, and
which cards accept the entity. Cards are web components that own their rendering entirely;
Lovelace owns only layout and config lifecycle. The visual editor is generated: a card exposes a
schema whose entries use **selectors** — a shared vocabulary of typed config inputs (`entity` with
domain/device_class filters, `number`, `boolean`, `icon`, …). Validation is at runtime:
`setConfig` throws and the host renders an error card in place.

**Steal:** selectors — one reusable typed vocabulary of config inputs shared by every editor, with
data-aware inputs that filter by semantic type. **Avoid:** the stringly-typed core;
`device_class` was retrofitted because "state is a string, attributes are a grab bag" pushed type
knowledge into every card. This is the argument for carrying field roles from day one.

## Backstage — the control group

Plugins export homepage **cards** via `createCardExtension` (component loader + title + optional
JSON-Schema settings, rendered with react-jsonschema-form); users compose cards on a grid. There
is **no shared data interchange**: each card fetches through typed dependency-injected service
interfaces (ApiRefs) and owns its own rendering. The consequence is the whole lesson: because the
plugin owns both data and rendering, users can only *place prebuilt cards* — they can never point
a generic table at Linear data. ApiRefs are a fine service-injection seam; the absence of an
interchange format is what forecloses user composition.

## Perses — kind/spec everywhere, plugin-shipped schemas

CNCF dashboards-as-code. Every object is a `kind` + `spec` envelope, recursively: panels hold a
plugin envelope (`kind: "TimeSeriesChart"`) and queries are themselves plugin envelopes. Layouts
reference panels by JSON pointer, so **one panel can appear in multiple layouts** — the precedent
for acorn's panel/placement split (`placements.md`). The distinctive bit: every plugin ships a CUE
schema for its config, and the *server* validates dashboards against those schemas without
executing plugin code.

**Steal:** plugins ship config schemas as data so persisted configs validate statically; panels
referenced by layouts rather than embedded in them. **Avoid:** CUE itself — the pattern matters,
not the language; Zod/JSON Schema gets most of it.

## VS Code — host-owned rendering, declarative contributions

Extensions declare capabilities statically in `package.json contributes` — the host indexes every
extension's surface without loading code, and `configuration` is literally JSON Schema from which
the settings UI is generated. The TreeView contract is the purest "plugin describes items, host
renders them": `TreeDataProvider` returns small typed `TreeItem` records (label, description,
icon, collapsible state, command, `contextValue`); extensions cannot style rows; `contextValue` +
declarative `when`-clause menus attach actions without the plugin owning UI. The escape hatch is
the webview — full rendering ownership, full isolation, zero consistency.

**Steal:** the typed-item contract keeps theming/accessibility/density consistent and lets the
host evolve rendering for free (acorn's descriptor tier is already this). **Avoid:** making the
typed contract so narrow that everyone flees to webviews — design it to cover the real 90%, and
plan the overflow path (for acorn: frame panes) rather than fighting it.

## Notion / Airtable / Linear — views over one typed collection

A collection (database/table/issue set) has a **field schema**: each property has a type from a
closed set — text, number, select, multi-select, status, date, person, relation, formula. A
**view** is a saved configuration over the same collection: view type + filters + sorts + group-by
+ visible fields + per-type display options. Table, board, list, calendar, timeline are all
projections of one dataset. **Kanban is not a component — it is group-by over a
finite-membership field** (select/status/person), with drag-between-columns writing back to that
field. Calendar is only offered if a date property exists. The view editor derives what it offers
from field types, so misconfiguration is largely unrepresentable.

**Steal:** the whole model — it is the cleanest user-facing shape in the survey and the one acorn's
dev-tool data (PRs, issues, errors: records with status-like fields) fits best. Its acknowledged
limit: single-collection, no joins — acorn keeps that limit too (`refused.md`), softened by
union + mapping (`composition.md`).

## Briefly

- **Datadog**: `widgets[]` with typed `requests`, plus a formulas layer (named queries `a`, `b`
  combined as `a / b * 100`) — a middle ground between raw queries and transformations.
- **Retool**: resources → queries → components glued by reactive JS template bindings and
  transformer scripts. Maximal flexibility; configs are "any JSON plus a program", so nothing can
  be validated, migrated, or editor-generated. The cautionary tale for skipping a type system.
- **Observable Plot**: infers scale types from column data types — schema drives visual-encoding
  defaults. Worth keeping as a principle for chart defaults.
- **Geckoboard**: each widget type historically defined its own bespoke push-payload schema, so
  every producer targeted every widget shape — the exact M×N problem DataFrame kills.
- **Glance / gethomepage.dev**: YAML widgets plus a "custom API" widget (URL + template/jsonpath).
  A good 80% for read-only glanceables, but templates hardcode presentation and there is no type
  layer, so nothing generic (sorting, grouping, charting) can be built on top.

## The four recurring patterns

1. **A neutral, typed interchange in the middle turns M×N into M+N.** Systems without one
   (Backstage, Geckoboard, template widgets) can only place prebuilt cards. For dev-tool data the
   record/collection shape (Notion) fits better than the metrics-flavored frame (Grafana), but
   keep Grafana's trick: display hints attach to the *field definition*, not the panel.
2. **The schema does triple duty.** Plugin-declared config schemas drive validation, persistence
   shape, and the *generated* settings editor (Perses, Grafana, VS Code, HA, Backstage). Never
   hand-write a panel settings UI that can drift from its schema. HA's selectors add the
   refinement: config inputs that reference the data layer ("pick a field of type date").
3. **The persisted unit separates query / transformation / view config, each owned by a different
   party.** Queries are source-owned and opaque (but nameable, refId-style); transformations and
   filter/sort/group are host-owned and declarative; view options are per-view and
   schema-declared. This split is what lets users swap the view without losing the query.
4. **Capability gating and defaults derive from field types.** Kanban = group-by over a
   finite field; calendar needs a date; scales infer from types; entity pickers filter by
   device_class. The view declares its axis requirements, the host matches them against the
   schema, and the editor only offers valid combinations — unrepresentable beats validated.

Two meta-lessons: **version the persisted model from day one** (Grafana's decade of schemaVersion
migrations and its current ground-up rewrite is the cost of deferring), and **decide where the
escape hatch is** (VS Code shows a narrow typed contract works only when the overflow path is
planned — for acorn, a frame pane).

## Nomenclature decisions

| acorn term | Meaning | Why, and what was rejected |
| --- | --- | --- |
| **collection** | A plugin-declared, typed, queryable set of records | "source" is taken by the rail; "datasource" (Grafana) collides with it; "database" implies storage. Notion's sense. |
| **field** (with **type** and optional **role**) | One typed property of a record | Universal across the survey. "role" is HA's device_class lesson, carried from day one. |
| **panel** | A self-contained unit: queries + mapping + shaping + a view | Grafana/Perses sense. "card" stays for the visual idiom (`FleetHome`), "widget" rejected as vague. |
| **view** | How a panel renders: table, list, stat, board — filter + sort + group + projection | The Notion sense; "view = projection over a typed collection" is how users will think. |
| **placement** | Where a panel renders, under whose constraints | From Perses' layouts-reference-panels; see `placements.md`. |
| **dashboard** | A named arrangement of panels — the default placement, not the unit of design | Deliberately demoted; see `placements.md`. |
| **selector** | A schema-driven config input in the generated editor | HA's word, kept as the internal name. |
