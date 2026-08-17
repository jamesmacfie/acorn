import type {
  PluginCollectionCell,
  PluginCollectionField,
  PluginCollectionFieldType,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { activityField } from '@acorn/dashboards-core/trend.ts'
import type { CollectionContribution } from '../registries/collections'
import { pruneMapping } from './mapping'
import {
  panelRefreshSeconds,
  viewsForSchema,
  type PanelDefinition,
  type PanelFilter,
  type PanelFilterOp,
  type PanelShaping,
  type PanelView,
  type PanelViewKind,
} from './model'
import { groupableFields } from './shaping'

// The derivations behind the GENERATED editor (docs/dashboards.md § The generated editor).
// The schema does triple duty — validation, the persisted shape, and the editor — and no
// panel settings UI is hand-written, because a hand-written editor drifts from its schema.
//
// The editor is composed of SELECTORS: typed, data-aware inputs that each know the schema they draw
// from ("pick a field of type enum", "pick a value of that field"). This module is the half of a
// selector that can be wrong — what it may offer — and `selectors.tsx` is the JSX for the answers.
// Splitting them is not ceremony: vitest here runs in node with no Solid plugin, so anything that
// lived inside the component would be unchecked.
//
// The rule every function here serves: MISCONFIGURATION IS MADE UNREPRESENTABLE RATHER THAN
// VALIDATED. Nothing below reports that a choice was bad; the choices that would be bad are not
// offered.

/** THE one door to "which schema does the editor draw from".
 *
 *  Two candidates, and the ANSWERED one wins — the same precedence `createPanelData` applies, so the
 *  editor and the panel never disagree about what a field is. A collection may declare a static
 *  schema in its manifest (github's pull requests), describe itself in its response (linear's issues,
 *  whose status names are the workspace's own and cannot be written at build time), or both.
 *
 *  The answered schema comes out of the node's own QueryClient under the query's key — the page the
 *  panel last drew, with no fetch of its own. The COLD case is the honest one and the caller must say
 *  so rather than pretend: a response-only collection nobody has read yet has no schema, so it gets
 *  the three views that ask nothing of the fields and no filter, sort or grouping — and the editor
 *  tells the person why instead of showing them an empty form. */
export const EMPTY_SCHEMA: PluginCollectionSchema = { fields: [] }

export const schemaOf = (
  entry: Pick<CollectionContribution, 'schema'> | undefined,
  answered?: PluginCollectionSchema | undefined,
): PluginCollectionSchema => (answered?.fields.length ? answered : entry?.schema ?? EMPTY_SCHEMA)

// ── Operators ─────────────────────────────────────────────────────────────────────────────────

/** Which comparisons a field's TYPE can answer. `contains` over a number is a string operation on a
 *  value that is not one; `eq` against a datetime is an epoch millisecond that will never be typed
 *  twice. Both parse fine and neither can ever be true, which is the class of thing this table
 *  exists to keep out of the editor rather than out of `shapeRows`. */
const OPERATORS: Record<PluginCollectionFieldType, readonly PanelFilterOp[]> = {
  text: ['contains', 'eq', 'ne'],
  number: ['eq', 'ne', 'gt', 'lt'],
  datetime: ['gt', 'lt'],
  enum: ['eq', 'ne'],
  boolean: ['eq'],
  // A display string, so both the exact name and a fragment of it are useful.
  person: ['eq', 'ne', 'contains'],
  link: ['contains'],
}

/** The two that are about the CELL rather than about a value, so they fit every type. */
const EMPTINESS: readonly PanelFilterOp[] = ['is-empty', 'is-not-empty']

export const operatorsForField = (field: PluginCollectionField | undefined): PanelFilterOp[] =>
  field ? [...OPERATORS[field.type], ...EMPTINESS] : []

export const operatorNeedsValue = (op: PanelFilterOp): boolean => op !== 'is-empty' && op !== 'is-not-empty'

/** `gt` reads as "after" over a date and "more than" over a number, and a filter row a person cannot
 *  read out loud is one they will set wrong. */
export function operatorLabel(op: PanelFilterOp, field: PluginCollectionField | undefined): string {
  switch (op) {
    case 'eq':
      return 'is'
    case 'ne':
      return 'is not'
    case 'contains':
      return 'contains'
    case 'gt':
      return field?.type === 'datetime' ? 'is after' : 'is more than'
    case 'lt':
      return field?.type === 'datetime' ? 'is before' : 'is less than'
    case 'is-empty':
      return 'is empty'
    case 'is-not-empty':
      return 'is not empty'
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────────────────────

/** The value a fresh filter row starts on. Every one of these is INERT — `contains ''` matches
 *  every row, `is after 0` matches every row that has a date — so adding a filter never makes rows
 *  disappear before the person has said what they wanted. The exception is `enum`, which has no
 *  inert value to offer: its first declared one is the honest starting point. */
function defaultValueFor(field: PluginCollectionField): PluginCollectionCell {
  switch (field.type) {
    case 'number':
    case 'datetime':
      return 0
    case 'boolean':
      return true
    case 'enum':
      return field.values?.[0]?.id ?? ''
    default:
      return ''
  }
}

export function defaultFilterFor(field: PluginCollectionField): PanelFilter {
  const op = operatorsForField(field)[0]
  return { field: field.id, op, ...(operatorNeedsValue(op) ? { value: defaultValueFor(field) } : {}) }
}

/** The same filter pointed at a different field. The operator survives only if the new type offers
 *  it, and the value never does — a `contains 'RAV'` carried onto a datetime is a filter that reads
 *  as configured and matches nothing. */
export function retargetFilter(filter: PanelFilter, field: PluginCollectionField): PanelFilter {
  const fresh = defaultFilterFor(field)
  if (!operatorsForField(field).includes(filter.op)) return fresh
  return { field: field.id, op: filter.op, ...(operatorNeedsValue(filter.op) ? { value: fresh.value } : {}) }
}

/** The same filter with a different operator, gaining or losing its value as the operator needs one.
 *  A stored value under `is-empty` is a value that renders nowhere and comes back on the next
 *  operator change, which is how a filter starts meaning something the editor never showed. */
export function withOperator(filter: PanelFilter, field: PluginCollectionField, op: PanelFilterOp): PanelFilter {
  if (!operatorNeedsValue(op)) return { field: filter.field, op }
  return { field: filter.field, op, value: filter.value ?? defaultValueFor(field) }
}

// ── Views and grouping ────────────────────────────────────────────────────────────────────────

/** The view kinds to offer for a collection, and the group-by field they imply. `board` appears only
 *  when the schema has an enum, which is the one gate in the whole editor with a component behind
 *  it: choosing board without a groupable field would produce a panel with no columns. */
export const viewsFor = (
  entry: Pick<CollectionContribution, 'schema'> | undefined,
  answered?: PluginCollectionSchema | undefined,
): PanelViewKind[] => viewsForSchema(schemaOf(entry, answered))

// ── Trends ────────────────────────────────────────────────────────────────────────────────────

/** Which trend tiers a stat over this schema may be offered (docs/dashboards.md § Trends).
 *
 *  The two gates are different in kind, which is why this is not one predicate: `activity` needs a
 *  DATETIME to bucket the rows by, so a schema without one cannot draw it; `history` needs only the
 *  node's sampler, which is feature presence rather than data presence — an empty series is a cold
 *  state to render, not a reason to withhold the choice. */
export const trendsFor = (schema: PluginCollectionSchema): NonNullable<PanelView['trend']>[] =>
  activityField(schema) ? ['activity', 'history'] : ['history']

/** The view with every reference to something this schema does not have removed — `retainShaping`'s
 *  rule applied to a view key, and for the same reason: a person who swapped the collection under a
 *  panel wrote `trend: 'activity'` against a schema that had a date, and no selector can catch a
 *  choice that was valid when it was made.
 *
 *  A response-only collection promises no fields at all, so there is nothing to check against and
 *  everything survives — the same escape hatch the shaping's own sweep takes. */
export function retainView(view: PanelView, schema: PluginCollectionSchema): PanelView {
  if (!schema.fields.length || view.trend !== 'activity' || activityField(schema)) return view
  const { trend: _dropped, ...rest } = view
  return rest
}

/** The group-by to write when the view becomes a board and the panel names none yet. The status-role
 *  field first — that is what the role vocabulary is for — then whatever enum there is. */
export const defaultGroupBy = (schema: PluginCollectionSchema): string | undefined => {
  const groupable = groupableFields(schema)
  return (groupable.find((field) => field.role === 'status') ?? groupable[0])?.id
}

// ── Output ────────────────────────────────────────────────────────────────────────────────────

const parseCount = (raw: string): number | undefined => {
  const value = Number(raw.trim())
  return raw.trim() && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}

/** A limit box that has been emptied means "no limit", not "zero rows". */
export const parseLimit = parseCount

/** Empty means "whatever the collection declared", which may itself be nothing. Clamped to the
 *  manifest's own bound on the way in rather than only on the way out, so the editor shows the
 *  number the panel will actually poll at. */
export const parseRefresh = (raw: string): number | undefined => {
  const value = parseCount(raw)
  return value === undefined ? undefined : panelRefreshSeconds(value, undefined)
}

/** The shaping with every reference to a field this schema does not have removed.
 *
 *  It exists because the two halves of the editor's promise are not the same thing. Selectors make a
 *  BAD choice unofferable; this makes a STALE one impossible — a filter on a field that stopped
 *  existing when the person swapped the collection under it, or when adding a second source moved the
 *  panel onto the mapped role vocabulary, was valid when it was written and no selector can catch it.
 *
 *  Exported as well as used by `normalizePanel` because the editor applies it LIVE on a source change:
 *  a form still showing filters over fields the panel no longer has is a form that saves something
 *  other than what it read.
 *
 *  Empty keys are pruned rather than stored empty, so a panel with nothing shaped serializes as the
 *  same `{}` the add flow creates. */
export function retainShaping(shaping: PanelShaping, schema: PluginCollectionSchema): PanelShaping {
  const declared = new Set(schema.fields.map((field) => field.id))
  // A response-only collection promises no fields at all, so there is nothing to check a stored
  // filter against and everything survives. Dropping a person's shaping because the collection
  // describes itself in its answer rather than in a manifest would be the opposite of the rule.
  const known = (id: string) => declared.size === 0 || declared.has(id)

  const filters = (shaping.filters ?? []).filter((filter) => known(filter.field))
  const sort = (shaping.sort ?? []).filter((key) => known(key.field))
  const fields = (shaping.fields ?? []).filter(known)
  const groupBy = shaping.groupBy && known(shaping.groupBy) ? shaping.groupBy : undefined
  const limit = shaping.limit !== undefined && Number.isFinite(shaping.limit) && shaping.limit >= 0
    ? Math.floor(shaping.limit)
    : undefined

  return {
    ...(filters.length ? { filters } : {}),
    ...(sort.length ? { sort } : {}),
    // A projection naming every field in declaration order is the same panel as no projection at
    // all, and storing it would freeze the column list against a schema that later grows one.
    ...(fields.length && fields.join() !== schema.fields.map((field) => field.id).join() ? { fields } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(groupBy ? { groupBy } : {}),
  }
}

/** Everything the editor produced, reduced to a definition the persisted codec will hand back
 *  unchanged: the shaping's stale references gone, the queries' blank params gone, the mapping's
 *  references to sources and columns that are no longer there gone. */
export function normalizePanel(panel: PanelDefinition, schema: PluginCollectionSchema): PanelDefinition {
  const shaping = retainShaping(panel.shaping, schema)

  // Every query, not just the first: `queries` is genuinely plural now, and a param left blank is a
  // param the plugin defaults rather than an empty string it has to interpret.
  const queries = panel.queries.map((query) => {
    const params = Object.fromEntries(
      Object.entries(query.params ?? {}).filter(([, value]) => value.trim().length > 0),
    )
    return {
      pluginId: query.pluginId,
      collectionId: query.collectionId,
      ...(Object.keys(params).length ? { params } : {}),
    }
  })

  // The mapping's own stale sweep, for the same reason the shaping has one: a value mapping written
  // against a source that has since been removed is valid config addressing nothing.
  const mapping = pruneMapping(panel.mapping, queries)

  return {
    id: panel.id,
    title: panel.title.trim(),
    queries,
    ...(mapping ? { mapping } : {}),
    shaping,
    view: retainView(panel.view, schema),
    ...(panel.refresh === undefined ? {} : { refresh: panel.refresh }),
  }
}
