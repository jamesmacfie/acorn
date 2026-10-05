import { isMappedDashboard, type DashboardMapping, type DashboardPanelContent, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataField } from '@acorn/protocol/dataBindings.ts'
import { DATA_SOURCE_PREVIEW_MODE } from '@acorn/protocol/dataSources.ts'
import { MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import type { SourceQueryEditorState } from '../dataSources/SourceQueryEditor'
import { dashboardFields, projectDashboardPanel } from '@acorn/dashboards-core/projection'
import { viewsForSchema, type PanelViewKind } from './model'
import { PANEL_STATUS_FIELD_ID } from './mapping'

export const emptyDashboardContent = (): DashboardPanelContent => ({
  title: 'New panel', queries: [],
  mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'list' }, fields: [] },
})

/** Drafts never published, newest first. A published panel's draft is its own, not an unfinished one. */
export const unpublishedDashboards = <T extends { publishedRevision: number | null; updatedAt: number }>(drafts: readonly T[]): T[] =>
  drafts.filter(draft => draft.publishedRevision === null).sort((left, right) => right.updatedAt - left.updatedAt)

const safeColumnId = (value: string): string => value.replace(/^\//, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || crypto.randomUUID()

/** The columns a panel starts with from its first source: one per field with a display role (title,
 *  status, assignee, url, updated), or the first six fields when the source declares no roles. Every
 *  field made a column buried the few that matter under dozens of IDs. */
export function defaultPlanColumns(sourceId: string, fields: ReturnType<typeof dashboardFields>): PanelPlan['columns'] {
  const roled = fields.filter(field => field.role)
  return (roled.length ? roled : fields.slice(0, 6)).map(field => fieldColumn(sourceId, field, safeColumnId(field.id)))
}

/** A column that reads one field, named and typed as the field is, with its unit, precision, and choices. */
export function fieldColumn(sourceId: string, field: ReturnType<typeof dashboardFields>[number], id: string): PanelPlan['columns'][number] {
  return {
    id, label: field.name, type: field.type, bind: { [sourceId]: { field: field.id } },
    ...(field.unit ? { unit: field.unit } : {}), ...(field.precision ? { precision: field.precision } : {}),
    ...(field.list ? { list: true } : {}), ...(field.values ? { choices: field.values } : {}),
  }
}

/** A column that now reads `pointer` from one source. A column that reads only that source takes the
 *  field's type, and its name too while it still has `placeholder` or the last field's name, so picking
 *  a field for a new column doesn't leave it "New column", typed as text. A column several sources
 *  feed keeps what was set, because the other sources' fields chose it. */
export function bindColumnField(
  column: PanelPlan['columns'][number],
  sourceId: string,
  pointer: string,
  fields: ReturnType<typeof dashboardFields>,
  placeholder: string,
): PanelPlan['columns'][number] {
  const bind = { ...column.bind, [sourceId]: { field: pointer } }
  const field = fields.find(candidate => candidate.id === pointer)
  if (!field || Object.keys(column.bind).some(id => id !== sourceId)) return { ...column, bind }
  const binding = column.bind[sourceId]
  const previous = binding && 'field' in binding ? fields.find(candidate => candidate.id === binding.field) : undefined
  const label = column.label === placeholder || column.label === previous?.name ? field.name : column.label
  return field.type === column.type ? { ...column, label, bind } : { ...fieldColumn(sourceId, field, column.id), label }
}

/** After a source switches, drops the column bindings the new source can't fill: a field it doesn't
 *  describe, or one of another type. A column with no type keeps any field the source still has. */
export function unbindMissingFields(
  columns: PanelPlan['columns'],
  sourceId: string,
  fields: readonly { id: string; type: string }[],
): PanelPlan['columns'] {
  return columns.map(column => {
    const binding = column.bind[sourceId]
    if (!binding || !('field' in binding) || fields.some(field => field.id === binding.field && (!column.type || field.type === column.type))) return column
    const { [sourceId]: _missing, ...bind } = column.bind
    return { ...column, bind }
  })
}

export function setDashboardQuery(
  content: DashboardPanelContent,
  id: string,
  reference: QueryReference | undefined,
): DashboardPanelContent {
  if (!reference) return removeDashboardQuery(content, id)
  const found = content.queries.find(query => query.id === id)
  return found
    ? { ...content, queries: content.queries.map(query => query.id === id ? { ...query, reference } : query) }
    : { ...content, queries: [...content.queries, { id, label: `Query ${content.queries.length + 1}`, reference }] }
}

export function removeDashboardQuery(content: DashboardPanelContent, id: string): DashboardPanelContent {
  const { [id]: _fields, ...fields } = content.mapping.fields
  const { [id]: _values, ...values } = content.mapping.values
  return { ...content, queries: content.queries.filter(query => query.id !== id), mapping: { ...content.mapping, fields, values } }
}

export function suggestRoleFields(mapping: DashboardMapping, instanceId: string, fields: readonly DataField[]): DashboardMapping {
  const current = mapping.fields[instanceId] ?? {}
  const suggested = { ...current }
  for (const role of ['title', 'status', 'assignee', 'updated', 'url'] as const) {
    if (suggested[role] !== undefined) continue
    const display = fields.find(candidate => candidate.display?.role === role)
    const field = role === 'status'
      ? (display ? fields.find(candidate => candidate.pointer === display.pointer.replace(/\/[^/]+$/, '/id')) : undefined)
        ?? fields.find(candidate => candidate.choices && /(?:state|status)/i.test(`${candidate.label} ${candidate.pointer}`))
        ?? display
      : display
    if (field) suggested[role] = field.pointer
  }
  return { ...mapping, fields: { ...mapping.fields, [instanceId]: suggested } }
}

export function setRoleField(mapping: DashboardMapping, instanceId: string, role: keyof DashboardMapping['fields'][string], pointer: string): DashboardMapping {
  return { ...mapping, fields: { ...mapping.fields, [instanceId]: { ...mapping.fields[instanceId], [role]: pointer } } }
}

export function mapExactStatus(mapping: DashboardMapping, instanceId: string, statusId: string, columnId: string): DashboardMapping {
  const current = mapping.values[instanceId] ?? {}
  const next = Object.fromEntries(Object.entries(current).map(([id, values]) => [id, values.filter(value => value !== statusId)]))
  if (columnId) next[columnId] = [...(next[columnId] ?? []), statusId]
  return { ...mapping, values: { ...mapping.values, [instanceId]: next } }
}

export function exactStatusFields(state: SourceQueryEditorState | undefined): DataField[] {
  return state?.description?.fields.filter(field => field.display?.role === 'status' || (field.choices && /state/i.test(field.label))) ?? []
}

export function exactStatusOptions(state: SourceQueryEditorState | undefined, pointer: string | undefined): { id: string; label: string }[] {
  if (!state?.description || !pointer) return []
  const field = state.description.fields.find(candidate => candidate.pointer === pointer)
  if (field?.choices?.kind === 'static') return field.choices.values
  const labelPointer = pointer.replace(/\/id$/, '/name')
  const values = new Map<string, string>()
  for (const record of state.preview?.records ?? []) {
    const id = readDataPointer(record.data, pointer)
    if (typeof id !== 'string') continue
    const label = readDataPointer(record.data, labelPointer)
    values.set(id, label === MISSING || typeof label !== 'string' ? id : label)
  }
  return [...values].map(([id, label]) => ({ id, label }))
}

export function displaySchema(
  states: Readonly<Record<string, SourceQueryEditorState | undefined>>,
  mapping: DashboardMapping = { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
) {
  const previews = Object.entries(states).flatMap(([instanceId, state]) => state?.query && state.description ? [{
    instanceId,
    label: instanceId,
    query: state.query,
    description: state.description,
    result: {
      records: [], revision: state.description.revision, readTime: 0,
      completeness: { kind: 'complete' as const }, mode: DATA_SOURCE_PREVIEW_MODE, evaluationTime: 0,
    },
  }] : [])
  if (!previews.length) return { fields: [] }
  return projectDashboardPanel({
    title: 'Display schema', queries: [], mapping,
    display: { view: { kind: 'list' }, fields: [] },
  }, previews).schema
}

export const availableDashboardViews = (
  states: Readonly<Record<string, SourceQueryEditorState | undefined>>,
  mapping?: DashboardMapping,
): PanelViewKind[] => {
  const schema = displaySchema(states, mapping)
  const hasMappedStatus = Object.values(mapping?.fields ?? {}).some(fields => !!fields.status)
  return viewsForSchema(hasMappedStatus && !schema.fields.some(field => field.type === 'enum')
    ? { fields: [...schema.fields, { id: 'status', name: 'Status', type: 'enum', role: 'status' }] }
    : schema)
}

export const unavailableViewReason = (kind: PanelViewKind): string => kind === 'board'
  ? 'Board needs a status or other field with a fixed set of values.'
  : kind === 'chart' ? 'Chart needs a status, category, or date field.' : ''

/** A board groups on the panel's status field, which only a mapped panel has. */
const groupOnStatus = (content: DashboardPanelContent): DashboardPanelContent => isMappedDashboard(content)
  ? { ...content, display: { ...content.display, groupBy: PANEL_STATUS_FIELD_ID } }
  : content

/** One board column per exact status of every query, keeping columns the owner already made. */
export function addStatusColumns(
  content: DashboardPanelContent,
  states: Readonly<Record<string, SourceQueryEditorState | undefined>>,
): DashboardPanelContent {
  const existing = new Map(content.mapping.columns.map(column => [column.id, column]))
  const values = structuredClone(content.mapping.values)
  for (const entry of content.queries) {
    for (const choice of exactStatusOptions(states[entry.id], content.mapping.fields[entry.id]?.status)) {
      existing.set(choice.id, existing.get(choice.id) ?? { id: choice.id, label: choice.label })
      values[entry.id] ??= {}
      values[entry.id]![choice.id] = [...new Set([...(values[entry.id]![choice.id] ?? []), choice.id])]
    }
  }
  return groupOnStatus({ ...content, mapping: { ...content.mapping, columns: [...existing.values()], values } })
}

/** Board columns from `suggestStateCategoryMapping`, replacing that query's exact status mapping. */
export function applyCategoryColumns(
  content: DashboardPanelContent,
  instanceId: string,
  suggestion: { columns: DashboardMapping['columns']; values: Record<string, string[]> },
): DashboardPanelContent {
  return groupOnStatus({
    ...content,
    mapping: {
      ...content.mapping,
      columns: [...new Map([...content.mapping.columns, ...suggestion.columns].map(column => [column.id, column])).values()],
      values: { ...content.mapping.values, [instanceId]: suggestion.values },
    },
  })
}

/** Shows or hides one field of the projected schema. An empty list means every field is visible. */
export function setFieldVisible(
  content: DashboardPanelContent,
  states: Readonly<Record<string, SourceQueryEditorState | undefined>>,
  fieldId: string,
  visible: boolean,
): DashboardPanelContent {
  const all = displaySchema(states, content.mapping).fields.map(candidate => candidate.id)
  const selected = content.display.fields.length ? content.display.fields : all
  const fields = visible ? [...new Set([...selected, fieldId])] : selected.filter(id => id !== fieldId)
  return { ...content, display: { ...content.display, fields } }
}
