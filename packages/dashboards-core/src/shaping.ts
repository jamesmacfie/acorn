import type {
  PluginCollectionCell,
  PluginCollectionField,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import type { PanelAggregate, PanelFilter, PanelShaping, PanelTone, PanelView } from './model'

// The shaping layer: filter, sort, limit, visible-field projection, generic and identical for every
// collection. See docs/dashboards.md § Panels for why shaping is client-side with server params as
// an optional optimisation, and § The generated editor for why this logic is pure functions tested
// outside the component.

const fieldsById = (schema: PluginCollectionSchema): Map<string, PluginCollectionField> =>
  new Map(schema.fields.map((field) => [field.id, field]))

const isBlank = (value: PluginCollectionCell | undefined): boolean => value === null || value === undefined || value === ''

/** What a cell equals. `enum` keys off the declared value id, never its label: the label is the part a
 *  workspace gets to rename (plugins/linear/src/shared/collections.ts), so a filter written against it
 *  would break the day someone renamed a column. */
const matchKey = (field: PluginCollectionField | undefined, value: PluginCollectionCell | undefined): string | number | null => {
  if (isBlank(value)) return null
  switch (field?.type) {
    case 'number':
    case 'datetime': {
      const numeric = Number(value)
      return Number.isFinite(numeric) ? numeric : null
    }
    case 'boolean':
      return value ? 1 : 0
    default:
      return String(value)
  }
}

/** What a cell sorts by. Identical to `matchKey` except for `enum`, which sorts by declaration order.
 *  A plugin declares its values in the order the thing moves (draft, open, ready), so that order is
 *  real information and alphabetising it would throw it away. A value the schema never declared sorts
 *  after every one it did. */
const sortKey = (field: PluginCollectionField | undefined, value: PluginCollectionCell | undefined): string | number | null => {
  if (isBlank(value)) return null
  if (field?.type === 'enum' && field.values?.length) {
    const index = field.values.findIndex((declared) => declared.id === String(value))
    return index === -1 ? field.values.length : index
  }
  return matchKey(field, value)
}

/** Ordering between two values that are both present. Blankness is decided by the callers, because
 *  they want different answers for it: a sort puts blanks last in both directions, and a relational
 *  filter matches neither side of one. */
const compare = (left: string | number, right: string | number): number => {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

/** `gt` and `lt` against a cell or a threshold that is not there. Neither answer is true: a row with no
 *  size is not "smaller than 4 MB", it is a row nobody measured. */
const relational = (
  cell: string | number | null,
  wanted: string | number | null,
  keep: (ordered: number) => boolean,
): boolean => cell !== null && wanted !== null && keep(compare(cell, wanted))

const matches = (field: PluginCollectionField | undefined, cell: PluginCollectionCell | undefined, filter: PanelFilter): boolean => {
  switch (filter.op) {
    case 'is-empty':
      return isBlank(cell)
    case 'is-not-empty':
      return !isBlank(cell)
    case 'contains':
      return String(cell ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase())
    case 'eq':
      return matchKey(field, cell) === matchKey(field, filter.value)
    case 'ne':
      return matchKey(field, cell) !== matchKey(field, filter.value)
    case 'gt':
      return relational(sortKey(field, cell), sortKey(field, filter.value), (ordered) => ordered > 0)
    case 'lt':
      return relational(sortKey(field, cell), sortKey(field, filter.value), (ordered) => ordered < 0)
  }
}

/** Filter, then sort, then limit, in that order. A limit applied before a sort is a random sample, and
 *  a filter applied after one is wasted work. */
export function shapeRows(
  rows: readonly PluginCollectionRow[],
  schema: PluginCollectionSchema,
  shaping: PanelShaping,
): PluginCollectionRow[] {
  const fields = fieldsById(schema)
  const filters = shaping.filters ?? []
  // All-AND: a filter list is a narrowing, and anything that needs alternatives has outgrown the
  // generic layer (model.ts, `PanelFilterOp`).
  let out = filters.length
    ? rows.filter((row) => filters.every((filter) => matches(fields.get(filter.field), row.values[filter.field], filter)))
    : [...rows]

  const sort = (shaping.sort ?? []).filter((key) => fields.has(key.field))
  if (sort.length) {
    out.sort((left, right) => {
      for (const key of sort) {
        const field = fields.get(key.field)
        const a = sortKey(field, left.values[key.field])
        const b = sortKey(field, right.values[key.field])
        // Blanks last in both directions, which is why this sits outside the direction flip below.
        // "This row has no value here" is a different fact from a low value, and a person scanning a
        // sorted list wants the rows that have the thing at the top either way.
        if (a === null || b === null) {
          if (a === b) continue
          return a === null ? 1 : -1
        }
        const ordered = compare(a, b)
        if (ordered !== 0) return key.direction === 'desc' ? -ordered : ordered
      }
      return 0
    })
  }

  if (shaping.limit !== undefined && Number.isFinite(shaping.limit) && shaping.limit >= 0) {
    out = out.slice(0, Math.floor(shaping.limit))
  }
  return out
}

/** The projection, in render order. A projected id the schema does not declare is dropped rather than
 *  retained: unknown-id survival is a persistence rule, and there is no column to draw. */
export function visibleFields(schema: PluginCollectionSchema, shaping: PanelShaping): PluginCollectionField[] {
  if (!shaping.fields?.length) return [...schema.fields]
  const fields = fieldsById(schema)
  return shaping.fields.flatMap((id) => {
    const field = fields.get(id)
    return field ? [field] : []
  })
}

/** What a list row leads with: the declared `title` role, then the first text field, then whatever
 *  there is. */
export function titleField(schema: PluginCollectionSchema): PluginCollectionField | undefined {
  return schema.fields.find((field) => field.role === 'title')
    ?? schema.fields.find((field) => field.type === 'text')
    ?? schema.fields[0]
}

export const fieldWithRole = (
  schema: PluginCollectionSchema,
  role: NonNullable<PluginCollectionField['role']>,
): PluginCollectionField | undefined => schema.fields.find((field) => field.role === role)

// ── Grouping ──────────────────────────────────────────────────────────────────────────────────
//
// See docs/dashboards.md § Views are derived, not chosen from a menu for why a board is group-by
// over a finite-valued field, not a component.

/** The fields a board may be keyed by: the ones with finite values.
 *
 *  `enum` only. `boolean` is finite too, and a two-column yes/no board is a real thing someone will
 *  eventually want, but it has no declared labels or tones, so it would need a synthesised pair of
 *  values that no other part of this layer has. Upgrade path: synthesise them here, where every
 *  caller already asks this one question. */
export const groupableFields = (schema: PluginCollectionSchema): PluginCollectionField[] =>
  schema.fields.filter((field) => field.type === 'enum')

/** The field a board groups by: the panel's own choice when it still names a groupable field, then the
 *  status-role enum, then the first enum there is.
 *
 *  The fallbacks are for a definition whose grouped field the plugin has since renamed or dropped. A
 *  board that silently became one giant column would look like the data broke rather than the schema.
 *  The editor always writes `groupBy` explicitly, so nothing reaches them by default. */
export function groupField(schema: PluginCollectionSchema, shaping: PanelShaping): PluginCollectionField | undefined {
  const groupable = groupableFields(schema)
  return groupable.find((field) => field.id === shaping.groupBy)
    ?? groupable.find((field) => field.role === 'status')
    ?? groupable[0]
}

/** The catch-all column's id. Leading space, because every other column id is a plugin-authored enum
 *  value and a bare `ungrouped` is a word somebody will eventually declare. */
export const UNGROUPED_COLUMN_ID = ' ungrouped'

export type PanelBoardColumn = {
  id: string
  label: string
  tone: PanelTone
  /** False for a value the schema never declared, and for the catch-all. Those two cannot be pre-toned
   *  or pre-ordered, and a view may want to say so. */
  declared: boolean
  rows: PluginCollectionRow[]
}

/** The columns of a board, in the order they are drawn. Three destinations, and every row lands in
 *  exactly one of them, so a value with nowhere to go is never silently dropped. See
 *  docs/dashboards.md § Views are derived, not chosen from a menu.
 *
 *  One case is worth spelling here: an undeclared value gets a column of its own after the declared
 *  ones, and a query-shaped collection cannot always know its values ahead of the data
 *  (@acorn/protocol/collections.ts), so that is the ordinary case there and schema drift here. */
export function boardColumns(
  rows: readonly PluginCollectionRow[],
  field: PluginCollectionField,
): PanelBoardColumn[] {
  const declared = field.values ?? []
  const buckets = new Map<string, PluginCollectionRow[]>(declared.map((value) => [value.id, []]))
  const order = declared.map((value) => value.id)
  const byId = new Map(declared.map((value) => [value.id, value]))
  const ungrouped: PluginCollectionRow[] = []

  for (const row of rows) {
    const cell = row.values[field.id]
    if (isBlank(cell)) {
      ungrouped.push(row)
      continue
    }
    const id = String(cell)
    const bucket = buckets.get(id)
    if (bucket) {
      bucket.push(row)
      continue
    }
    buckets.set(id, [row])
    order.push(id)
  }

  const columns = order.map((id): PanelBoardColumn => {
    const value = byId.get(id)
    return {
      id,
      label: value?.label ?? id,
      tone: value?.tone ?? 'muted',
      declared: !!value,
      rows: buckets.get(id) ?? [],
    }
  })
  if (ungrouped.length) {
    columns.push({ id: UNGROUPED_COLUMN_ID, label: 'Uncategorised', tone: 'muted', declared: false, rows: ungrouped })
  }
  return columns
}

const AGGREGATORS: Record<Exclude<PanelAggregate, 'count'>, (values: number[]) => number> = {
  sum: (values) => values.reduce((total, value) => total + value, 0),
  avg: (values) => values.reduce((total, value) => total + value, 0) / values.length,
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
}

/** The single number a `stat` view draws, over the already-shaped rows. `null` when the panel asks for
 *  an aggregate over a field that is not there or holds no numbers. The view renders an em dash, the
 *  same "no answer" a fleet card shows, rather than a fabricated 0. */
export function aggregateRows(
  rows: readonly PluginCollectionRow[],
  schema: PluginCollectionSchema,
  view: PanelView,
): number | null {
  const aggregate = view.aggregate ?? 'count'
  if (aggregate === 'count') return rows.length
  const field = view.field ? fieldsById(schema).get(view.field) : undefined
  if (!field) return null
  const values = rows.flatMap((row) => {
    const numeric = Number(row.values[field.id])
    return isBlank(row.values[field.id]) || !Number.isFinite(numeric) ? [] : [numeric]
  })
  if (!values.length) return null
  return AGGREGATORS[aggregate](values)
}
