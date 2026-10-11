import type {
  DashboardDisplayCell,
  DashboardDisplayField,
  DashboardDisplayRow,
  DashboardDisplaySchema,
} from './display'
import {
  panelSourceKey,
  type PanelFieldDef,
  type PanelMapping,
  type PanelMappingColumn,
  type PanelProjectionSource,
} from './model'

// The mapping layer: field mapping, value mapping, derived enum, in that order. See
// docs/dashboards/mapping-and-editor.md § The mapping layer, and cross-source panels for what each layer does and why.
// Pure over `(sources, mapping)`, tested outside the component for the reason docs/dashboards/mapping-and-editor.md §
// The generated editor gives.

/** One source's answer, as the mapping layer sees it. */
export type PanelSourcePage = {
  source: PanelProjectionSource
  schema: DashboardDisplaySchema
  rows: readonly DashboardDisplayRow[]
}

// ── The panel-local field vocabulary ──────────────────────────────────────────────────────────
//
// Five role fields, fixed, plus however many the user invented (`mapping.extraFields`). See
// docs/dashboards/mapping-and-editor.md § The mapping layer, and cross-source panels for why the vocabulary is capped
// at roles.

const ROLE_FIELDS = [
  { id: 'title', name: 'Title', type: 'text', role: 'title' },
  // Also the derived enum. See docs/dashboards/mapping-and-editor.md § The mapping layer, and cross-source panels.
  { id: 'status', name: 'Status', type: 'enum', role: 'status' },
  { id: 'assignee', name: 'Assignee', type: 'person', role: 'assignee' },
  { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
  { id: 'url', name: 'Link', type: 'link', role: 'url' },
] as const satisfies readonly DashboardDisplayField[]

/** The panel-local field the derived enum lives on, and therefore what a mapped board groups by. */
const PANEL_STATUS_FIELD_ID = 'status'

/** Where a row came from, as an ordinary panel-local field, fed by the host's stamp described in
 *  docs/dashboards/panels.md § Provenance, and what a row may not claim. See docs/dashboards/mapping-and-editor.md § The
 *  mapping layer, and cross-source panels for why source is a field rather than a special case, and
 *  why it carries no tone.
 *
 *  No id collision is possible: panel-local ids never cross the wire, and an invented field's id is
 *  minted (`newColumnId`) rather than typed. */
export const PANEL_SOURCE_FIELD_ID = 'source'

/** The plugin's id, and the source alongside it only where one plugin provides two of this panel's
 *  sources. The registry's display name would read better but lives in client-core, which this package
 *  can't import; pass one down if it ever matters. */
const sourceLabel = (source: PanelProjectionSource, sources: readonly PanelProjectionSource[]): string =>
  sources.filter((other) => other.pluginId === source.pluginId).length > 1
    ? `${source.pluginId} · ${source.sourceId}`
    : source.pluginId

const provenanceField = (sources: readonly PanelProjectionSource[]): DashboardDisplayField[] =>
  sources.length < 2
    ? []
    : [
        {
          id: PANEL_SOURCE_FIELD_ID,
          name: 'Source',
          type: 'enum',
          values: sources.map((source) => ({ id: panelSourceKey(source), label: sourceLabel(source, sources) })),
        },
      ]

const asField = (definition: PanelFieldDef): DashboardDisplayField => ({
  id: definition.id,
  name: definition.label,
  type: definition.type,
})

/** The panel-local vocabulary for a given mapping: the five roles, then whatever the user invented in
 *  declaration order, then `source` on a panel with more than one. Everything downstream walks this one
 *  list, so an invented field is never a special case.
 *
 *  `queries` is optional, and its absence is the mapping matrix's answer: the matrix asks "which of
 *  this source's fields feeds each panel field", and `source` has nothing to answer. Callers that
 *  render data pass the queries; the matrix doesn't. */
export const panelFieldsFor = (
  mapping: PanelMapping | undefined,
  sources: readonly PanelProjectionSource[] = [],
): DashboardDisplayField[] => [
  ...ROLE_FIELDS,
  ...(mapping?.extraFields ?? []).map(asField),
  ...provenanceField(sources),
]

/** Does this panel use the mapping layer at all?
 *
 *  Explicit triggers: more than one source, declared columns (an enum the user invented even over one
 *  source), an invented field, or an explicit role/value mapping. A single-source panel with none
 *  of them takes the untouched pre-mapping path, so its rows and schema pass through verbatim. */
export const isMapped = (sources: readonly PanelProjectionSource[], mapping: PanelMapping | undefined): boolean =>
  sources.length > 1 ||
  !!mapping?.columns?.length ||
  !!mapping?.extraFields?.length ||
  !!Object.keys(mapping?.fields ?? {}).length ||
  !!Object.keys(mapping?.bySource ?? {}).length

// ── Field mapping ─────────────────────────────────────────────────────────────────────────────

/** Which of a source's fields feeds a panel-local field. See docs/dashboards/mapping-and-editor.md § The mapping layer,
 *  and cross-source panels for why the role is the runtime default rather than a copy, and what an
 *  explicit `''` means. */
export function sourceFieldFor(
  source: PanelSourcePage,
  panelFieldId: string,
  mapping: PanelMapping | undefined,
): string | undefined {
  const declared = mapping?.fields?.[panelSourceKey(source.source)]?.[panelFieldId]
  if (declared !== undefined) return declared || undefined
  const role = ROLE_FIELDS.find((field) => field.id === panelFieldId)?.role
  // An invented field has no role, so there's nothing to fall back to and an unanswered one is simply
  // unmapped for that source. The pre-fill is the payoff of the role vocabulary, and an invented field
  // is exactly where the host has no opinion to offer.
  if (!role) return undefined
  return source.schema.fields.find((field) => field.role === role)?.id
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

/** The values of the source field feeding the panel's status, which is what the value-mapping matrix
 *  has rows for. Empty for a source whose status field declares none, meaning a source that
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

const EMPTY_SCHEMA: DashboardDisplaySchema = { fields: [] }

/** The schema the shaping layer and the views actually see.
 *
 *  Unmapped: the single source's own schema, untouched. Mapped: the role fields at least one source can
 *  fill, with the status field carrying the user's columns as its declared values, which is what makes
 *  `boardColumns` draw the user's board without knowing a mapping exists.
 *
 *  A mapped panel with one source names each field as that source does, and a status field with no
 *  columns keeps the values that source declares. Without that, a panel of tasks would print the raw
 *  id "active" on a grey dot though the source says "Active", and call its fields "Title" and "Status"
 *  whatever the source called them. */
export function panelSchema(
  sources: readonly PanelSourcePage[],
  mapping: PanelMapping | undefined,
): DashboardDisplaySchema {
  const projections = sources.map((source) => source.source)
  if (!isMapped(projections, mapping)) return sources[0]?.schema ?? EMPTY_SCHEMA
  const fields = panelFieldsFor(mapping, projections).flatMap((field): DashboardDisplayField[] => {
    // The host feeds this one. No source has to be able to fill it, and no mapping row points at it.
    if (field.id === PANEL_SOURCE_FIELD_ID) return [field]
    if (!sources.some((source) => sourceFieldFor(source, field.id, mapping))) return []
    // The one source's own field, when there is one source: its name, and for status its values.
    const ownId = sources.length === 1 ? sourceFieldFor(sources[0]!, field.id, mapping) : undefined
    const own = ownId ? sources[0]!.schema.fields.find((candidate) => candidate.id === ownId) : undefined
    const named = own ? { ...field, name: own.name } : field
    if (field.id !== PANEL_STATUS_FIELD_ID) return [named]
    const columns = mapping?.columns ?? []
    if (columns.length) return [{ ...named, values: columns }]
    // No columns yet means no derived enum. One source keeps the words and tones it declares; across
    // several, the board builds its columns out of whatever arrived: two vocabularies side by side.
    return [own?.values ? { ...named, values: own.values } : named]
  })
  return { fields }
}

/** Every source's rows as one list of panel-local rows.
 *
 *  Provenance is the host's stamp (docs/dashboards/panels.md § Provenance, and what a row may not claim):
 *  `pluginId` and the query-instance `sourceId` are copied from the typed record reference, never
 *  accepted from a plugin-controlled display row.
 *
 *  No value is silently dropped. A value no column claims lands in the catch-all, `null`, which
 *  `boardColumns` draws as one "Uncategorised" column, or is hidden only because the user declared
 *  that destination.
 *
 *  Row ids are qualified by source. A github row and a linear row may both be `42`; the wire promises
 *  uniqueness within one projected query and nothing wider. */
export function unionRows(
  sources: readonly PanelSourcePage[],
  mapping: PanelMapping | undefined,
): DashboardDisplayRow[] {
  const projections = sources.map((source) => source.source)
  if (!isMapped(projections, mapping)) return [...(sources[0]?.rows ?? [])]

  const fields = panelSchema(sources, mapping).fields
  const columns = mapping?.columns ?? []
  const hideUnmapped = mapping?.unmapped === 'hidden'
  // Present exactly when the panel unions more than one source, and written from the same host stamp the
  // provenance badge reads, so a source can't file its rows under a stranger's identity.
  const stampsSource = fields.some((field) => field.id === PANEL_SOURCE_FIELD_ID)

  return sources.flatMap((source) => {
    const key = panelSourceKey(source.source)
    const sourceFields = fields.map((field) => [field.id, sourceFieldFor(source, field.id, mapping)] as const)
    return source.rows.flatMap((row): DashboardDisplayRow[] => {
      const values: Record<string, DashboardDisplayCell> = {}
      for (const [panelFieldId, sourceFieldId] of sourceFields) {
        if (!sourceFieldId) continue
        values[panelFieldId] = row.values[sourceFieldId] ?? null
      }
      if (stampsSource) values[PANEL_SOURCE_FIELD_ID] = key
      if (columns.length) {
        const raw = values[PANEL_STATUS_FIELD_ID]
        const column =
          raw === null || raw === undefined || raw === '' ? undefined : mappedColumnId(mapping, key, String(raw))
        if (!column && hideUnmapped) return []
        values[PANEL_STATUS_FIELD_ID] = column ?? null
      }
      return [
        {
          id: `${key}:${row.id}`,
          // The row's own id before this qualification, because the qualification is for rendering and the
          // action isn't: a click hands the id to the plugin's pane as its selection, and a pane told to
          // select `agents:sessions:<uuid>` finds nothing. `id` stays qualified, because two sources can
          // collide on `42` and the board dedupes on it.
          sourceRowId: row.id,
          ...(row.records ? { records: row.records } : {}),
          ...(row.recordItems ? { recordItems: row.recordItems } : {}),
          values,
          // Carried for the same reason `action` is: they're one thing. The action opens a pane and this
          // says in which task, so a mapped panel that dropped it would send every click to the "open a
          // task first" refusal.
          ...(row.taskId ? { taskId: row.taskId } : {}),
          ...(row.action ? { action: row.action } : {}),
          ...(row.actions ? { actions: row.actions } : {}),
          ...(row.target ? { target: row.target } : {}),
          pluginId: row.pluginId,
          sourceId: row.sourceId,
        },
      ]
    })
  })
}
