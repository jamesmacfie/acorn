import { COLLECTION_FIELD_TYPES, type PluginCollectionFieldType } from '@acorn/protocol/collections.ts'
import type {
  PanelDefinition,
  PanelFieldDef,
  PanelFilter,
  PanelFilterOp,
  PanelMapping,
  PanelMappingColumn,
  PanelMappingColumnDef,
  PanelQuery,
  PanelShaping,
  PanelSort,
  PanelTone,
  PanelView,
} from './model'

// The panel-definition codec (docs/dashboards.md § Persistence).
//
// It lived in client-core/dashboards/persist.ts, beside the store and the slice registration, until
// the node needed it: the measure sampler reads the SAME prefs blob the clients write, and has to
// parse it through the same parser rather than a second one that agrees today
// (docs/future/cron/targets.md § seam 2). persist.ts keeps the store, the slice and the GEOMETRY
// codec — a rect is a client rendering concern and the node has no use for one.
//
// Hand-written rather than a Zod schema, matching every other slice: a codec must TOLERATE malformed
// input and never throw (the conformance suite calls it with `'{not-json'` and with a string the size
// of the whole budget), and the shapes are shallow enough that a parser is shorter than a schema plus
// its error handling.
//
// UNKNOWN IDS SURVIVE. Parsing answers "is this shaped like a panel?", never "is that collection
// registered in this build?" — the pane-layout rule verbatim (tasks/layout.ts): the registry lookup
// happens at RENDER time and an unresolved panel draws as inert rather than disappearing. A person's
// composition is never collateral damage of switching a plugin off.

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') out[key] = entry
  return out
}

const FILTER_OPS: readonly PanelFilterOp[] = ['eq', 'ne', 'contains', 'gt', 'lt', 'is-empty', 'is-not-empty']

const parseQuery = (raw: unknown): PanelQuery | undefined => {
  if (!isRecord(raw)) return undefined
  const pluginId = str(raw.pluginId)
  const collectionId = str(raw.collectionId)
  // The pair IS the address. A query missing either half names nothing, which is a different case
  // from naming something this build cannot resolve — that one is kept.
  if (!pluginId || !collectionId) return undefined
  const params = stringRecord(raw.params)
  return { pluginId, collectionId, ...(params && Object.keys(params).length ? { params } : {}) }
}

const parseFilter = (raw: unknown): PanelFilter | undefined => {
  if (!isRecord(raw)) return undefined
  const field = str(raw.field)
  const op = FILTER_OPS.find((candidate) => candidate === raw.op)
  if (!field || !op) return undefined
  const value = raw.value
  const usable = value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  return { field, op, ...(usable ? { value } : {}) }
}

const parseSort = (raw: unknown): PanelSort | undefined => {
  if (!isRecord(raw)) return undefined
  const field = str(raw.field)
  if (!field) return undefined
  return { field, direction: raw.direction === 'desc' ? 'desc' : 'asc' }
}

const list = <T>(raw: unknown, parse: (entry: unknown) => T | undefined): T[] =>
  Array.isArray(raw) ? raw.flatMap((entry) => { const parsed = parse(entry); return parsed ? [parsed] : [] }) : []

const parseShaping = (raw: unknown): PanelShaping => {
  if (!isRecord(raw)) return {}
  const filters = list(raw.filters, parseFilter)
  const sort = list(raw.sort, parseSort)
  const fields = Array.isArray(raw.fields) ? raw.fields.filter((entry): entry is string => typeof entry === 'string') : []
  const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) && raw.limit >= 0 ? Math.floor(raw.limit) : undefined
  // Kept whether or not this build has an enum field to hang it on, for the same reason an unknown
  // view kind is: the grouping is what a board IS, and a pass through a client whose plugin set
  // differs must not be what deletes it.
  const groupBy = str(raw.groupBy)
  return {
    ...(filters.length ? { filters } : {}),
    ...(sort.length ? { sort } : {}),
    ...(fields.length ? { fields } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(groupBy ? { groupBy } : {}),
  }
}

// ── The mapping codec ─────────────────────────────────────────────────────────────────────────
//
// The one place a key is carried across UNREAD on purpose. `writeValue` is the write-back seam
// (model.ts § PanelMappingColumn): nothing in this read-only build sets it or looks at it, and it
// still round-trips, because a reserved shape that the codec quietly deletes is not reserved.

const parseMappingColumn = (raw: unknown): PanelMappingColumn | undefined => {
  if (!isRecord(raw)) return undefined
  const values = Array.isArray(raw.values)
    ? raw.values.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
  const writeValue = str(raw.writeValue)
  const entry: PanelMappingColumn = {
    ...(values.length ? { values } : {}),
    ...(writeValue ? { writeValue } : {}),
  }
  return Object.keys(entry).length ? entry : undefined
}

const TONES: readonly PanelTone[] = ['ok', 'warn', 'bad', 'muted', 'accent']

const parseColumn = (raw: unknown): PanelMappingColumnDef | undefined => {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  const label = str(raw.label)
  // The pair IS the column: an id with no label draws a blank heading and a label with no id is
  // unreferenceable from `bySource`.
  if (!id || !label) return undefined
  const tone = TONES.find((candidate) => candidate === raw.tone)
  return { id, label, ...(tone ? { tone } : {}) }
}

const FIELD_TYPES: readonly PluginCollectionFieldType[] = COLLECTION_FIELD_TYPES

const parseFieldDef = (raw: unknown): PanelFieldDef | undefined => {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  const label = str(raw.label)
  // The pair IS the field, same rule as a column — and the type has to be one this build renders,
  // because every view dispatches on it.
  const type = FIELD_TYPES.find((candidate) => candidate === raw.type)
  if (!id || !label || !type) return undefined
  return { id, label, type }
}

const parseMapping = (raw: unknown): PanelMapping | undefined => {
  if (!isRecord(raw)) return undefined
  const columns = list(raw.columns, parseColumn)
  const extraFields = list(raw.extraFields, parseFieldDef)

  const bySource: Record<string, Record<string, PanelMappingColumn>> = {}
  if (isRecord(raw.bySource)) {
    for (const [key, entries] of Object.entries(raw.bySource)) {
      if (!isRecord(entries)) continue
      const kept: Record<string, PanelMappingColumn> = {}
      for (const [columnId, entry] of Object.entries(entries)) {
        const parsed = parseMappingColumn(entry)
        // NOT filtered against `columns`: an entry naming a column this blob does not carry is the
        // same class of thing as an unknown pane id, and the render-time half already ignores it.
        if (parsed) kept[columnId] = parsed
      }
      if (Object.keys(kept).length) bySource[key] = kept
    }
  }

  const fields: Record<string, Record<string, string>> = {}
  if (isRecord(raw.fields)) {
    for (const [key, entries] of Object.entries(raw.fields)) {
      // `''` survives: it is the user saying "this source has nothing for that panel field", which
      // is a different answer from an absent key (model.ts § PanelMapping).
      const mapped = stringRecord(entries)
      if (mapped && Object.keys(mapped).length) fields[key] = mapped
    }
  }

  const mapping: PanelMapping = {
    ...(columns.length ? { columns } : {}),
    ...(Object.keys(bySource).length ? { bySource } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(extraFields.length ? { extraFields } : {}),
    ...(raw.unmapped === 'hidden' ? { unmapped: 'hidden' as const } : {}),
  }
  return Object.keys(mapping).length ? mapping : undefined
}

const parseView = (raw: unknown): PanelView => {
  if (!isRecord(raw)) return { kind: 'list' }
  // Any non-empty kind is kept, INCLUDING one this build cannot draw. Coercing a `board` written by
  // a newer client into a list would destroy the panel on the first round trip through an older
  // one, and these definitions are shared by every client paired with the node.
  const kind = str(raw.kind) ?? 'list'
  const aggregate = str(raw.aggregate)
  const field = str(raw.field)
  // The chart keys, tolerantly. Same additive posture as every other key in this slice: an old
  // client that WRITES the blob drops them and the chart falls back to its inferred defaults — the
  // panel itself survives, and an old client RENDERING a `chart` panel already shows "view
  // unavailable" rather than coercing it to something it can draw.
  const shape = raw.shape === 'bar' || raw.shape === 'line' ? raw.shape : undefined
  const x = str(raw.x)
  const series = str(raw.series)
  // The trend keys (docs/dashboards.md § Trends), literal-checked exactly
  // like `shape` above and dropped when malformed. `trend: 'history'` is also what the NODE's
  // sampler selects on, so a client that drops these keys on a round trip does not corrupt the
  // panel — the series simply stops accruing until a newer client writes them back.
  const trend = raw.trend === 'history' || raw.trend === 'activity' ? raw.trend : undefined
  const compare = raw.compare === 'day' || raw.compare === 'week' ? raw.compare : undefined
  const good = raw.good === 'up' || raw.good === 'down' ? raw.good : undefined
  return {
    kind,
    ...(aggregate ? { aggregate: aggregate as PanelView['aggregate'] } : {}),
    ...(field ? { field } : {}),
    ...(shape ? { shape } : {}),
    ...(x ? { x } : {}),
    ...(series ? { series } : {}),
    ...(trend ? { trend } : {}),
    ...(compare ? { compare } : {}),
    ...(good ? { good } : {}),
  }
}

export function parsePanelDefinition(raw: unknown): PanelDefinition | undefined {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  if (!id) return undefined
  const queries = list(raw.queries, parseQuery)
  if (!queries.length) return undefined
  const mapping = parseMapping(raw.mapping)
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    queries,
    ...(mapping ? { mapping } : {}),
    shaping: parseShaping(raw.shaping),
    view: parseView(raw.view),
    ...(typeof raw.refresh === 'number' && Number.isFinite(raw.refresh) ? { refresh: raw.refresh } : {}),
  }
}

/** The definitions and the placements, and deliberately not the geometry. This is everything the
 *  SAMPLER needs out of the prefs blob — which panels exist, and whether any surface draws them —
 *  and the client's own parser (persist.ts) builds on it by adding the rect codec.
 *
 *  Not filtered against each other: a placement naming a panel with no definition is the same class
 *  of thing as an unknown pane id, and dropping it here would make a partially-written blob lose
 *  placements. */
export function parsePanels(value: unknown): {
  panels: Record<string, PanelDefinition>
  placements: Record<string, string[]>
} {
  if (!isRecord(value)) return { panels: {}, placements: {} }
  const panels: Record<string, PanelDefinition> = {}
  if (isRecord(value.panels)) {
    for (const [id, entry] of Object.entries(value.panels)) {
      const panel = parsePanelDefinition(entry)
      // The map key wins over whatever the row claims: a definition filed under a stranger's id
      // would be unreachable by every placement that references it.
      if (panel) panels[id] = { ...panel, id }
    }
  }
  const placements: Record<string, string[]> = {}
  if (isRecord(value.placements)) {
    for (const [key, entry] of Object.entries(value.placements)) {
      if (!Array.isArray(entry)) continue
      placements[key] = entry.filter((id): id is string => typeof id === 'string' && id.length > 0)
    }
  }
  return { panels, placements }
}
