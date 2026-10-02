import type { DashboardDraft, DashboardMapping, DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataField } from '@acorn/protocol/dataBindings.ts'
import { DATA_SOURCE_PREVIEW_MODE } from '@acorn/protocol/dataSources.ts'
import { MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import type { SourceQueryEditorState } from '../dataSources/SourceQueryEditor'
import { projectDashboardPanel } from '@acorn/dashboards-core/projection'
import { viewsForSchema, type PanelViewKind } from './model'

export const emptyDashboardContent = (): DashboardPanelContent => ({
  title: 'New panel', queries: [],
  mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'list' }, fields: [] },
})

export const latestUnpublishedDashboard = (drafts: readonly DashboardDraft[]): DashboardDraft | undefined =>
  drafts.filter(draft => draft.publishedRevision === null).sort((left, right) => right.updatedAt - left.updatedAt)[0]

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
