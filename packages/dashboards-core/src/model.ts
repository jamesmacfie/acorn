import { PANEL_VIEW_KINDS, type PanelViewKind } from '@acorn/protocol/collections.ts'
import type {
  PluginCollectionCell,
  PluginCollectionEnumValue,
  PluginCollectionFieldType,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'

// The panel definition: what a user composed, independent of where it is placed. The four layers and
// what each one owns are in docs/dashboards.md § Panels.
//
// Two shapes here were fixed before the mapping layer existed, because getting either wrong would
// have been a migration rather than an addition. Both survived it unchanged:
//
//   `queries` is an array, and genuinely plural. A panel unions the rows of several collections, and a
//   single `query` key would have made that a persisted-model version bump.
//
//   `mapping` is a per-(source, column) record, never a value-to-column lookup. See
//   PanelMappingColumn.
//
// Display hints are not here. A unit, a tone or an enum's label hangs off the field
// (@acorn/protocol/collections.ts), which is what makes switching a panel from a table to a list
// lossless. Grafana's `FieldConfig` lesson.

export type PanelId = string

/** One collection reference plus the params the plugin declared. Opaque to the host past the schema:
 *  the plugin owns what a param means. Grafana's opaque-target lesson. */
export type PanelQuery = {
  pluginId: string
  collectionId: string
  params?: Record<string, string>
}

/** How `mapping` addresses one entry of `queries`: the `(pluginId, collectionId)` pair, the way the
 *  whole app addresses a collection, rather than the array index. An index shifts when a source is
 *  removed, and a mapping that silently rebinds onto a different provider's values is worse than one
 *  that goes missing. Spelled here rather than imported from registries/collections.ts so the model
 *  keeps no dependency on the registry; the two strings are the same by construction. */
export const panelSourceKey = (query: PanelQuery): string => `${query.pluginId}:${query.collectionId}`

// Shaping is generic and identical for every collection, and it runs client-side over the returned
// rows as the baseline. Declared server-side params are an optimisation a collection may offer, never
// a requirement, which keeps the plugin obligation at "answer with your rows".

/** Small and all-AND. An OR or nested predicate tree is a query language, and a panel that needs one
 *  has outgrown the generic shaping layer. */
export type PanelFilterOp = 'eq' | 'ne' | 'contains' | 'gt' | 'lt' | 'is-empty' | 'is-not-empty'

export type PanelFilter = {
  field: string
  op: PanelFilterOp
  /** Absent for the two emptiness ops, which are about the cell rather than about a value. */
  value?: PluginCollectionCell
}

export type PanelSort = {
  field: string
  direction: 'asc' | 'desc'
}

export type PanelShaping = {
  /** Every filter must pass. */
  filters?: PanelFilter[]
  /** First key wins, later keys break ties. */
  sort?: PanelSort[]
  limit?: number
  /** Visible-field projection, in render order. Absent means every field the schema declares. */
  fields?: string[]
  /** The field whose values are the groups, which is a board's columns. Shaping rather than a view
   *  option, so flipping a board to a table and back keeps the grouping the way it keeps the filters.
   *  See docs/dashboards.md § Panels. */
  groupBy?: string
}

export type PanelAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'

// One open object rather than a discriminated union, because an unknown `kind` has to survive. A
// definition written by a client that has the board view must round-trip through one that does not,
// and a union would force the codec to coerce it to something this build can draw. Same posture as an
// unknown pane id in a task layout (tasks/layout.ts): retained here, resolved at render.
export type PanelView = {
  /** One of PANEL_VIEW_KINDS. Anything else renders inert. */
  kind: string
  /** The measure, shared by `stat` and `chart`. Defaults to `count`, which is why a chart over a
   *  collection with no number field still draws. Shared rather than duplicated so flipping between
   *  stat and chart keeps what the panel is counting. */
  aggregate?: PanelAggregate
  /** The measure's field. Required by every aggregate but `count`. */
  field?: string
  /** `chart` only: which of the two shapes. Absent falls back to whatever the schema supports
   *  (chart.ts, `buildChart`), so an older definition never draws nothing. */
  shape?: 'bar' | 'line'
  /** `chart` only: the category field (bar) or the time field (line). */
  x?: string
  /** `chart` only, and optional there: the enum whose values split one line into several. */
  series?: string
  /** `stat` only; other kinds ignore all three. See docs/dashboards.md § Trends.
   *
   *  `activity` is "when did these rows change", bucketed from the rows already on screen and needing
   *  no store. `history` is "what was this number", which only the node's measure sampler can answer,
   *  and it is what `core:sample-measures` selects a panel on. They are two features wearing one mark,
   *  so never blur them. */
  trend?: 'history' | 'activity'
  /** The lookback for the delta beside the number. A point looked up, never a window aggregated. */
  compare?: 'day' | 'week'
  /** Which direction is good, which is not guessable: open PRs going up is bad for one person's board
   *  and good for another's. Absent renders the delta in neutral ink rather than a guessed green.
   *  Display config on the panel, unlike units and tones, which are the plugin's facts and hang off
   *  the field. */
  good?: 'up' | 'down'
}

/** One (source, column) cell of the value mapping.
 *
 *  A record per column rather than a bare value-to-column lookup, and that shape was fixed before
 *  anything read it. Value mappings are many-to-one and so not invertible: github's `merged` and
 *  `closed` may both land in a `Done` column, so dropping a card on `Done` has no unique answer. The
 *  eventual answer is a designated write value per (source, column), with drag disabled wherever none
 *  is set (docs/future/dashboards/write-back.md). A lookup has nowhere to put that; this has a field to
 *  grow, and `writeValue` is that field. Nothing writes or reads it in this read-only build, and the
 *  codec carries it across unread so the shape is real rather than promised. */
export type PanelMappingColumn = {
  /** The source's own enum values that land in this column. */
  values?: string[]
  /** Write-back, reserved: the value written when a card is dropped here. */
  writeValue?: string
}

/** The user's own derived enum: one column of the board they invented. */
export type PanelMappingColumnDef = { id: string; label: string; tone?: PanelTone }

/** A panel-local field the user invented, beyond the five roles.
 *
 *  The five roles are the only thing two independently written collections agree about without being
 *  asked, which is why the mapped vocabulary starts there. It is also a real ceiling, and this is the
 *  release valve. github's `repo` and linear's `identifier` are both text and both useful on a mixed
 *  board, and neither has a role. The user names the field and says, per source, which of its fields
 *  feeds it: the same matrix the editor already draws, one row longer.
 *
 *  The `type` comes from the wire's own field vocabulary, so an invented field renders, sorts, filters
 *  and groups exactly like a declared one and there is no second rendering path. Nothing new crosses
 *  the wire: this is a client-side composition, invisible to every plugin. */
export type PanelFieldDef = { id: string; label: string; type: PluginCollectionFieldType }

export type PanelMapping = {
  /** The derived enum's values: the columns a board is keyed by, in the order they are drawn. Absent
   *  means the panel groups on each source's own values, which is honest but reads as two providers'
   *  vocabularies side by side. */
  columns?: PanelMappingColumnDef[]
  /** `panelSourceKey → columnId → entry`. */
  bySource?: Record<string, Record<string, PanelMappingColumn>>
  /** Per source, panel-local field id to that source's field id. An empty string is an explicit "this
   *  source has nothing for that field", which differs from an absent key: absent falls back to the
   *  source's field carrying the matching role, which is the pre-fill. An invented field has no role
   *  to fall back to, so for one of those an absent key means unmapped. */
  fields?: Record<string, Record<string, string>>
  /** The panel-local fields the user invented, drawn after the five roles in the order declared. */
  extraFields?: PanelFieldDef[]
  /** Where a value no column claims goes. Never nowhere: an unmapped value has a declared destination.
   *  Default catch-all. See docs/dashboards.md § The mapping layer, and cross-source panels. */
  unmapped?: 'catch-all' | 'hidden'
}

/** The host's own status vocabulary (ui/primitives.tsx, `StatusDot`), which is also the wire's. A
 *  user-invented column tones itself from the same five a plugin's declared value can. */
export type PanelTone = NonNullable<PluginCollectionEnumValue['tone']>

export type PanelDefinition = {
  id: PanelId
  title: string
  /** One or more. Several unions their rows client-side; see mapping.ts. */
  queries: PanelQuery[]
  mapping?: PanelMapping
  shaping: PanelShaping
  view: PanelView
  /** Seconds. Absent means "whatever the collection declared", which may itself be nothing. */
  refresh?: number
}

// ── Views ─────────────────────────────────────────────────────────────────────────────────────
//
// ── Views ─────────────────────────────────────────────────────────────────────────────────────
//
// Views are derived from the schema, not chosen from a widget menu: a kanban is not a component, it is
// group-by over a field with finite values. Every view's gate is one predicate over the schema, and
// the editor offers only what passes. See docs/dashboards.md § Views are derived, not chosen from a
// menu.

/** The views this build draws. The list moved to the wire when a manifest gained the ability to narrow
 *  it (@acorn/protocol/collections.ts, `PANEL_VIEW_KINDS`); re-exported here because forty call sites
 *  say `./model` and one vocabulary cannot live in two places. */
export { PANEL_VIEW_KINDS }
export type { PanelViewKind }

const VIEW_REQUIRES: Record<PanelViewKind, (schema: PluginCollectionSchema) => boolean> = {
  // A count over nothing is still a number, so these three ask nothing of the schema.
  stat: () => true,
  list: () => true,
  table: () => true,
  // Columns are the values of a grouped enum, so without one there is nothing to group by.
  board: (schema) => schema.fields.some((field) => field.type === 'enum'),
  // A bar needs a category axis and a line needs a time axis; a schema with neither has nothing to
  // draw against, however many numbers it carries. Spelled here rather than imported so the model
  // keeps no dependency on the chart module. `chartShapesFor` is the same predicate, and chart.test.ts
  // holds the two together.
  chart: (schema) => schema.fields.some((field) => field.type === 'enum' || field.type === 'datetime'),
}

export const viewSupportedBy = (kind: PanelViewKind, schema: PluginCollectionSchema): boolean =>
  VIEW_REQUIRES[kind](schema)

/** What a panel editor may offer for this schema, and nothing else. A collection with no enum field is
 *  never offered a board, so a panel that cannot draw is unrepresentable rather than validated. See
 *  docs/dashboards.md § The generated editor. */
export const viewsForSchema = (schema: PluginCollectionSchema): PanelViewKind[] =>
  PANEL_VIEW_KINDS.filter((kind) => viewSupportedBy(kind, schema))

export const isDrawnViewKind = (kind: string): kind is PanelViewKind =>
  (PANEL_VIEW_KINDS as readonly string[]).includes(kind)

// ── Refresh ───────────────────────────────────────────────────────────────────────────────────

// The manifest's own bound, re-spelled because it is declared inline on the descriptor schema
// (@acorn/protocol/pluginContract.ts) rather than exported. A user-set panel refresh is held to the
// same range a plugin's declared one is: below 30s a panel is a poller, above a day it is a page load.
export const MIN_PANEL_REFRESH_SECONDS = 30
export const MAX_PANEL_REFRESH_SECONDS = 86_400

/** The panel's own refresh if it set one, else the collection's declared hint, else no polling at all.
 *  Chrome keeps its single shared revision (plugins/chrome/data.ts); a panel is the first contribution
 *  whose refetch cost is worth a signal of its own. */
export function panelRefreshSeconds(panel: number | undefined, declared: number | undefined): number | undefined {
  const wanted = panel ?? declared
  if (wanted === undefined || !Number.isFinite(wanted)) return undefined
  return Math.min(MAX_PANEL_REFRESH_SECONDS, Math.max(MIN_PANEL_REFRESH_SECONDS, Math.round(wanted)))
}

// ── Construction ──────────────────────────────────────────────────────────────────────────────

export const newPanelId = (): PanelId => crypto.randomUUID()

/** A panel over one collection, with nothing shaped and the safest view. `list` rather than `table`
 *  because a list needs no column choice to be readable, and a collection that declares no static
 *  schema has none to choose from before its first answer. */
export const panelForCollection = (query: PanelQuery, title: string): PanelDefinition => ({
  id: newPanelId(),
  title,
  queries: [query],
  shaping: {},
  view: { kind: 'list' },
})
