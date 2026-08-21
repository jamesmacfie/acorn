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

// Panel-definition codec, shared with the node's measure sampler. Hand-written and tolerant like
// every other slice, and unknown ids survive intact. See docs/dashboards.md § Persistence.

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
  // Both pluginId and collectionId are required, or the query is dropped. A collectionId this
  // build cannot resolve is a different case, kept and resolved at render time.
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
  // groupBy is kept even with no matching enum field in this build: the grouping is part of the
  // panel's composition, and a pass through a client with a different plugin set must not delete
  // it (docs/dashboards.md § Persistence, "Unknown ids survive inert").
  const groupBy = str(raw.groupBy)
  return {
    ...(filters.length ? { filters } : {}),
    ...(sort.length ? { sort } : {}),
    ...(fields.length ? { fields } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(groupBy ? { groupBy } : {}),
  }
}

// Mapping codec. writeValue round-trips unread; see docs/dashboards.md § Persistence.

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
  // id and label are both required: an id with no label draws a blank heading, and a label with
  // no id can't be referenced from bySource.
  if (!id || !label) return undefined
  const tone = TONES.find((candidate) => candidate === raw.tone)
  return { id, label, ...(tone ? { tone } : {}) }
}

const FIELD_TYPES: readonly PluginCollectionFieldType[] = COLLECTION_FIELD_TYPES

const parseFieldDef = (raw: unknown): PanelFieldDef | undefined => {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  const label = str(raw.label)
  // id, label and type are all required for a field def. type must be one this build can render,
  // since every view dispatches on it.
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
      // Not filtered against columns: an entry naming a column this blob doesn't carry is kept and
      // ignored at render, same as any other unknown id (docs/dashboards.md § Persistence).
        if (parsed) kept[columnId] = parsed
      }
      if (Object.keys(kept).length) bySource[key] = kept
    }
  }

  const fields: Record<string, Record<string, string>> = {}
  if (isRecord(raw.fields)) {
    for (const [key, entries] of Object.entries(raw.fields)) {
      // An explicit '' means this source has nothing for this field, a different answer from an
      // absent key. See docs/dashboards.md § The mapping layer.
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
  // Any non-empty kind is kept, including one this build can't draw: coercing it would corrupt a
  // definition written by a newer client. See docs/dashboards.md § Persistence.
  const kind = str(raw.kind) ?? 'list'
  const aggregate = str(raw.aggregate)
  const field = str(raw.field)
  // The chart keys, tolerantly parsed. See docs/dashboards.md § Persistence.
  const shape = raw.shape === 'bar' || raw.shape === 'line' ? raw.shape : undefined
  const x = str(raw.x)
  const series = str(raw.series)
  // The trend keys, parsed the same way. See docs/dashboards.md § Persistence.
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

/** Definitions and placements only, not geometry: everything the sampler needs from the prefs
 *  blob. See docs/dashboards.md § Persistence. */
export function parsePanels(value: unknown): {
  panels: Record<string, PanelDefinition>
  placements: Record<string, string[]>
} {
  if (!isRecord(value)) return { panels: {}, placements: {} }
  const panels: Record<string, PanelDefinition> = {}
  if (isRecord(value.panels)) {
    for (const [id, entry] of Object.entries(value.panels)) {
      const panel = parsePanelDefinition(entry)
      // The record key becomes the id, overriding whatever the row itself claims: a definition filed
      // under the wrong key would be unreachable from placements that reference it by that key.
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
