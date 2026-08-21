import type {
  PluginCollectionCell,
  PluginCollectionField,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import {
  panelSourceKey,
  type PanelFieldDef,
  type PanelMapping,
  type PanelMappingColumn,
  type PanelQuery,
} from './model'

// The mapping layer: field mapping, value mapping, derived enum, in that order. See
// docs/dashboards.md § The mapping layer, and cross-source panels for what each layer does and why.
// Pure over `(sources, mapping)`, tested outside the component for the reason docs/dashboards.md §
// The generated editor gives.

/** One source's answer, as the mapping layer sees it. */
export type PanelSourcePage = {
  query: PanelQuery
  schema: PluginCollectionSchema
  rows: readonly PluginCollectionRow[]
}

// ── The panel-local field vocabulary ──────────────────────────────────────────────────────────
//
// Five role fields, fixed, plus however many the user invented (`mapping.extraFields`). See
// docs/dashboards.md § The mapping layer, and cross-source panels for why the vocabulary is capped
// at roles.

const ROLE_FIELDS = [
  { id: 'title', name: 'Title', type: 'text', role: 'title' },
  // Also the derived enum. See docs/dashboards.md § The mapping layer, and cross-source panels.
  { id: 'status', name: 'Status', type: 'enum', role: 'status' },
  { id: 'assignee', name: 'Assignee', type: 'person', role: 'assignee' },
  { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
  { id: 'url', name: 'Link', type: 'link', role: 'url' },
] as const satisfies readonly PluginCollectionField[]

export const PANEL_FIELDS: readonly PluginCollectionField[] = ROLE_FIELDS

/** The panel-local field the derived enum lives on, and therefore what a mapped board groups by. */
export const PANEL_STATUS_FIELD_ID = 'status'

/** Where a row came from, as an ordinary panel-local field, fed by the host's stamp described in
 *  docs/dashboards.md § Provenance, and what a row may not claim. See docs/dashboards.md § The
 *  mapping layer, and cross-source panels for why source is a field rather than a special case, and
 *  why it carries no tone.
 *
 *  No id collision is possible: panel-local ids never cross the wire, and an invented field's id is
 *  minted (`newColumnId`) rather than typed. */
export const PANEL_SOURCE_FIELD_ID = 'source'

/** The plugin's id, and the collection alongside it only where one plugin provides two of this panel's
 *  sources. The registry's display name would read better but lives in client-core, which this package
 *  can't import; pass one down if it ever matters. */
const sourceLabel = (query: PanelQuery, queries: readonly PanelQuery[]): string =>
  queries.filter((other) => other.pluginId === query.pluginId).length > 1
    ? `${query.pluginId} · ${query.collectionId}`
    : query.pluginId

const provenanceField = (queries: readonly PanelQuery[]): PluginCollectionField[] =>
  queries.length < 2
    ? []
    : [{
      id: PANEL_SOURCE_FIELD_ID,
      name: 'Source',
      type: 'enum',
      values: queries.map((query) => ({ id: panelSourceKey(query), label: sourceLabel(query, queries) })),
    }]

const asField = (definition: PanelFieldDef): PluginCollectionField =>
  ({ id: definition.id, name: definition.label, type: definition.type })

/** The panel-local vocabulary for a given mapping: the five roles, then whatever the user invented in
 *  declaration order, then `source` on a panel with more than one. Everything downstream walks this one
 *  list, so an invented field is never a special case.
 *
 *  `queries` is optional, and its absence is the mapping matrix's answer: the matrix asks "which of
 *  this source's fields feeds each panel field", and `source` has nothing to answer. Callers that
 *  render data pass the queries; the matrix doesn't. */
export const panelFieldsFor = (
  mapping: PanelMapping | undefined,
  queries: readonly PanelQuery[] = [],
): PluginCollectionField[] =>
  [...ROLE_FIELDS, ...(mapping?.extraFields ?? []).map(asField), ...provenanceField(queries)]

/** An invented field's id is never a role's, so `undefined` here means "this is one of the five". */
const extraField = (mapping: PanelMapping | undefined, panelFieldId: string): PanelFieldDef | undefined =>
  mapping?.extraFields?.find((definition) => definition.id === panelFieldId)

/** Does this panel use the mapping layer at all?
 *
 *  Three explicit triggers: more than one source, declared columns (an enum the user invented even over
 *  one source), or an invented field. A single-collection panel with none of them takes the untouched
 *  pre-mapping path, so its rows and schema pass through verbatim. */
export const isMapped = (queries: readonly PanelQuery[], mapping: PanelMapping | undefined): boolean =>
  queries.length > 1 || !!mapping?.columns?.length || !!mapping?.extraFields?.length

// ── Field mapping ─────────────────────────────────────────────────────────────────────────────

/** Which of a source's fields feeds a panel-local field. See docs/dashboards.md § The mapping layer,
 *  and cross-source panels for why the role is the runtime default rather than a copy, and what an
 *  explicit `''` means. */
export function sourceFieldFor(
  source: PanelSourcePage,
  panelFieldId: string,
  mapping: PanelMapping | undefined,
): string | undefined {
  const declared = mapping?.fields?.[panelSourceKey(source.query)]?.[panelFieldId]
  if (declared !== undefined) return declared || undefined
  const role = ROLE_FIELDS.find((field) => field.id === panelFieldId)?.role
  // An invented field has no role, so there's nothing to fall back to and an unanswered one is simply
  // unmapped for that source. The pre-fill is the payoff of the role vocabulary, and an invented field
  // is exactly where the host has no opinion to offer.
  if (!role) return undefined
  return source.schema.fields.find((field) => field.role === role)?.id
}

/** The suggestion the host shows its work for. "Both of these collections have a status-role enum,
 *  here's a mapping" is the whole argument for the role vocabulary, and this is where it's cashed.
 *
 *  Only fields the user hasn't already answered are filled, so pressing it twice is harmless and a
 *  hand-made choice is never overwritten. The result is written into the config rather than applied
 *  invisibly, so the editor's selects show exactly what the panel will do. */
export function suggestFieldMapping(
  sources: readonly PanelSourcePage[],
  mapping: PanelMapping | undefined,
): PanelMapping['fields'] {
  const out: Record<string, Record<string, string>> = { ...(mapping?.fields ?? {}) }
  for (const source of sources) {
    const key = panelSourceKey(source.query)
    const existing = out[key] ?? {}
    const suggested: Record<string, string> = { ...existing }
    for (const field of ROLE_FIELDS) {
      if (suggested[field.id] !== undefined) continue
      const match = source.schema.fields.find((candidate) => candidate.role === field.role)
      if (match) suggested[field.id] = match.id
    }
    if (Object.keys(suggested).length) out[key] = suggested
  }
  return Object.keys(out).length ? out : undefined
}

/** The source fields a panel-local field may be pointed at: the ones whose semantic type matches.
 *  Pointing the `updated` column at a text field would sort alphabetically on one source and
 *  chronologically on the other, which is what the type vocabulary was bought to prevent. */
export const candidateFieldsFor = (
  source: PanelSourcePage,
  panelFieldId: string,
  mapping?: PanelMapping | undefined,
): PluginCollectionField[] => {
  const type = ROLE_FIELDS.find((field) => field.id === panelFieldId)?.type
    ?? extraField(mapping, panelFieldId)?.type
  return type ? source.schema.fields.filter((field) => field.type === type) : []
}

// ── Value mapping ─────────────────────────────────────────────────────────────────────────────

const entryFor = (
  mapping: PanelMapping | undefined,
  sourceKey: string,
  columnId: string,
): PanelMappingColumn | undefined => mapping?.bySource?.[sourceKey]?.[columnId]

/** The column one source value lands in, or `undefined` for a value no column claims. */
export function mappedColumnId(
  mapping: PanelMapping | undefined,
  sourceKey: string,
  value: string,
): string | undefined {
  for (const column of mapping?.columns ?? []) {
    if (entryFor(mapping, sourceKey, column.id)?.values?.includes(value)) return column.id
  }
  return undefined
}

/** Put a source value in a column, or nowhere when `columnId` is undefined. A value belongs to at most
 *  one column of its source: a value in two columns would put the same card in two places. */
export function withMappedValue(
  mapping: PanelMapping,
  sourceKey: string,
  value: string,
  columnId: string | undefined,
): PanelMapping {
  const forSource: Record<string, PanelMappingColumn> = {}
  for (const column of mapping.columns ?? []) {
    const entry = entryFor(mapping, sourceKey, column.id)
    const values = (entry?.values ?? []).filter((candidate) => candidate !== value)
    if (column.id === columnId) values.push(value)
    // The entry survives an empty `values`, because it may already carry a `writeValue` and dropping it
    // would silently delete a write-back destination the user set.
    const next = { ...(entry ?? {}), ...(values.length ? { values } : {}) }
    if (!values.length) delete next.values
    if (Object.keys(next).length) forSource[column.id] = next
  }
  const bySource = { ...(mapping.bySource ?? {}) }
  if (Object.keys(forSource).length) bySource[sourceKey] = forSource
  else delete bySource[sourceKey]
  const next: PanelMapping = { ...mapping }
  if (Object.keys(bySource).length) next.bySource = bySource
  else delete next.bySource
  return next
}

/** Fill in the value mapping the host can honestly guess: a source value whose id or label matches a
 *  column's id or label, case-insensitively. linear's `completed` labelled "Done" finds a column called
 *  Done; github's `ready` finds nothing and stays unmapped, which is correct. The host doesn't invent a
 *  destination and then hide that it guessed.
 *
 *  Values the user already placed are left alone, so this is safe to press at any time. */
export function suggestValueMapping(
  sources: readonly PanelSourcePage[],
  mapping: PanelMapping,
): PanelMapping {
  const columns = mapping.columns ?? []
  if (!columns.length) return mapping
  let next = mapping
  for (const source of sources) {
    const key = panelSourceKey(source.query)
    for (const value of statusValuesOf(source, mapping)) {
      if (mappedColumnId(next, key, value.id)) continue
      const wanted = [value.id, value.label].map((text) => text.toLowerCase())
      const column = columns.find((candidate) =>
        wanted.includes(candidate.id.toLowerCase()) || wanted.includes(candidate.label.toLowerCase()))
      if (column) next = withMappedValue(next, key, value.id, column.id)
    }
  }
  return next
}

/** The values of the source field feeding the panel's status, which is what the value-mapping matrix
 *  has rows for. Empty for a source whose status field declares none, meaning a collection that
 *  describes itself in its answer and hasn't been read yet. */
export function statusValuesOf(
  source: PanelSourcePage,
  mapping: PanelMapping | undefined,
): { id: string; label: string }[] {
  const id = sourceFieldFor(source, PANEL_STATUS_FIELD_ID, mapping)
  const field = source.schema.fields.find((candidate) => candidate.id === id)
  return (field?.values ?? []).map((value) => ({ id: value.id, label: value.label }))
}

// ── The union ─────────────────────────────────────────────────────────────────────────────────

const EMPTY_SCHEMA: PluginCollectionSchema = { fields: [] }

/** The schema the shaping layer and the views actually see.
 *
 *  Unmapped: the single source's own schema, untouched. Mapped: the role fields at least one source can
 *  fill, with the status field carrying the user's columns as its declared values, which is what makes
 *  `boardColumns` draw the user's board without knowing a mapping exists. */
export function panelSchema(
  sources: readonly PanelSourcePage[],
  mapping: PanelMapping | undefined,
): PluginCollectionSchema {
  const queries = sources.map((source) => source.query)
  if (!isMapped(queries, mapping)) return sources[0]?.schema ?? EMPTY_SCHEMA
  const fields = panelFieldsFor(mapping, queries).flatMap((field): PluginCollectionField[] => {
    // The host feeds this one. No source has to be able to fill it, and no mapping row points at it.
    if (field.id === PANEL_SOURCE_FIELD_ID) return [field]
    if (!sources.some((source) => sourceFieldFor(source, field.id, mapping))) return []
    if (field.id !== PANEL_STATUS_FIELD_ID) return [field]
    const columns = mapping?.columns ?? []
    // No columns yet means no derived enum, so the field carries no declared values and the board
    // builds its columns out of whatever arrived: two providers' vocabularies side by side.
    return [columns.length ? { ...field, values: columns } : field]
  })
  return { fields }
}

/** Every source's rows as one list of panel-local rows.
 *
 *  Provenance is the host's stamp (docs/dashboards.md § Provenance, and what a row may not claim):
 *  `pluginId` and `collectionId` are copied off the row the host stamped when it parsed the response
 *  (plugins/chrome/data.ts), never off the response body.
 *
 *  No value is silently dropped. A value no column claims lands in the catch-all, `null`, which
 *  `boardColumns` draws as one "Uncategorised" column, or is hidden only because the user declared
 *  that destination.
 *
 *  Row ids are qualified by source. A github row and a linear row may both be `42`; the wire promises
 *  uniqueness within a collection and nothing wider (@acorn/protocol/collections.ts). */
export function unionRows(
  sources: readonly PanelSourcePage[],
  mapping: PanelMapping | undefined,
): PluginCollectionRow[] {
  const queries = sources.map((source) => source.query)
  if (!isMapped(queries, mapping)) return [...(sources[0]?.rows ?? [])]

  const fields = panelSchema(sources, mapping).fields
  const columns = mapping?.columns ?? []
  const hideUnmapped = mapping?.unmapped === 'hidden'
  // Present exactly when the panel unions more than one source, and written from the same host stamp the
  // provenance badge reads, so a collection can't file its rows under a stranger's source.
  const stampsSource = fields.some((field) => field.id === PANEL_SOURCE_FIELD_ID)

  return sources.flatMap((source) => {
    const key = panelSourceKey(source.query)
    const sourceFields = fields.map((field) => [field.id, sourceFieldFor(source, field.id, mapping)] as const)
    return source.rows.flatMap((row): PluginCollectionRow[] => {
      const values: Record<string, PluginCollectionCell> = {}
      for (const [panelFieldId, sourceFieldId] of sourceFields) {
        if (!sourceFieldId) continue
        values[panelFieldId] = row.values[sourceFieldId] ?? null
      }
      if (stampsSource) values[PANEL_SOURCE_FIELD_ID] = key
      if (columns.length) {
        const raw = values[PANEL_STATUS_FIELD_ID]
        const column = raw === null || raw === undefined || raw === ''
          ? undefined
          : mappedColumnId(mapping, key, String(raw))
        if (!column && hideUnmapped) return []
        values[PANEL_STATUS_FIELD_ID] = column ?? null
      }
      return [{
        id: `${key}:${row.id}`,
        // The row's own id before this qualification, because the qualification is for rendering and the
        // action isn't: a click hands the id to the plugin's pane as its selection, and a pane told to
        // select `agents:sessions:<uuid>` finds nothing. `id` stays qualified, because two sources can
        // collide on `42` and the board dedupes on it.
        sourceRowId: row.id,
        values,
        // Carried for the same reason `action` is: they're one thing. The action opens a pane and this
        // says in which task, so a mapped panel that dropped it would send every click to the "open a
        // task first" refusal.
        ...(row.taskId ? { taskId: row.taskId } : {}),
        ...(row.action ? { action: row.action } : {}),
        pluginId: row.pluginId,
        collectionId: row.collectionId,
      }]
    })
  })
}

// ── Pruning ───────────────────────────────────────────────────────────────────────────────────

/** The mapping with everything naming a source or column the panel no longer has removed, and
 *  `undefined` when nothing is left. The counterpart of `normalizePanel`'s stale-shaping sweep: a value
 *  mapping written against a dropped source is valid config addressing nothing, and it would come back
 *  the day a source with the same key was added again. */
export function pruneMapping(
  mapping: PanelMapping | undefined,
  queries: readonly PanelQuery[],
): PanelMapping | undefined {
  if (!mapping) return undefined
  const keys = new Set(queries.map(panelSourceKey))
  const columns = (mapping.columns ?? []).filter((column) => column.id && column.label)
  const columnIds = new Set(columns.map((column) => column.id))
  const extraFields = (mapping.extraFields ?? []).filter((field) => field.id && field.label)
  // The five roles plus whatever survived above. Anything else a `fields` entry names is a field the
  // person deleted, and keeping it would bring the old mapping back the day they invented a field with
  // the same id.
  const fieldIds = new Set([...PANEL_FIELDS.map((field) => field.id), ...extraFields.map((field) => field.id)])

  const bySource: Record<string, Record<string, PanelMappingColumn>> = {}
  for (const [key, entries] of Object.entries(mapping.bySource ?? {})) {
    if (!keys.has(key)) continue
    const kept: Record<string, PanelMappingColumn> = {}
    for (const [columnId, entry] of Object.entries(entries)) {
      if (columnIds.has(columnId) && entry && Object.keys(entry).length) kept[columnId] = entry
    }
    if (Object.keys(kept).length) bySource[key] = kept
  }

  const fields: Record<string, Record<string, string>> = {}
  for (const [key, entries] of Object.entries(mapping.fields ?? {})) {
    if (!keys.has(key)) continue
    const kept = Object.fromEntries(Object.entries(entries).filter(([fieldId]) => fieldIds.has(fieldId)))
    if (Object.keys(kept).length) fields[key] = kept
  }

  const next: PanelMapping = {
    ...(columns.length ? { columns } : {}),
    ...(Object.keys(bySource).length ? { bySource } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(extraFields.length ? { extraFields } : {}),
    ...(mapping.unmapped === 'hidden' ? { unmapped: 'hidden' as const } : {}),
  }
  // A panel that isn't mapped has no use for any of it: the field mapping the editor pre-filled on the
  // way in, and everything a second source left behind, are config the single-collection path never
  // reads. Kept, they'd come back the day a source was re-added and quietly reshape a panel somebody
  // had since made their own.
  if (!isMapped(queries, next)) return undefined
  return Object.keys(next).length ? next : undefined
}

/** A fresh column id, minted rather than slugged from the label, so renaming a column doesn't rebind
 *  every value mapped into it. */
export const newColumnId = (): string => crypto.randomUUID().slice(0, 8)
