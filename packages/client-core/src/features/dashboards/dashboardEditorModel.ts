import { type PanelPlan } from '@acorn/protocol/dashboards.ts'
import { MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import type { SourceQueryEditorState } from '../dataSources/SourceQueryEditor'
import { dashboardFields } from '@acorn/dashboards-core/projection'

/** Drafts never published, newest first. A published panel's draft is its own, not an unfinished one. */
export const unpublishedDashboards = <T extends { publishedRevision: number | null; updatedAt: number }>(
  drafts: readonly T[],
): T[] =>
  drafts.filter((draft) => draft.publishedRevision === null).sort((left, right) => right.updatedAt - left.updatedAt)

const safeColumnId = (value: string): string =>
  value
    .replace(/^\//, '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 100) || crypto.randomUUID()

/** The columns a panel starts with from its first source: one per field with a display role (title,
 *  status, assignee, url, updated), or the first six fields when the source declares no roles. Making
 *  every field a column would bury the few that matter under dozens of IDs. */
export function defaultPlanColumns(sourceId: string, fields: ReturnType<typeof dashboardFields>): PanelPlan['columns'] {
  const roled = fields.filter((field) => field.role)
  return (roled.length ? roled : fields.slice(0, 6)).map((field) =>
    fieldColumn(sourceId, field, safeColumnId(field.id)),
  )
}

/** A column that reads one field, named and typed as the field is, with its unit, precision, and choices. */
export function fieldColumn(
  sourceId: string,
  field: ReturnType<typeof dashboardFields>[number],
  id: string,
): PanelPlan['columns'][number] {
  return {
    id,
    label: field.name,
    type: field.type,
    bind: { [sourceId]: { field: field.id } },
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.precision ? { precision: field.precision } : {}),
    ...(field.list ? { list: true } : {}),
    ...(field.values ? { choices: field.values } : {}),
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
  const field = fields.find((candidate) => candidate.id === pointer)
  if (!field || Object.keys(column.bind).some((id) => id !== sourceId)) return { ...column, bind }
  const binding = column.bind[sourceId]
  const previous =
    binding && 'field' in binding ? fields.find((candidate) => candidate.id === binding.field) : undefined
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
  return columns.map((column) => {
    const binding = column.bind[sourceId]
    if (
      !binding ||
      !('field' in binding) ||
      fields.some((field) => field.id === binding.field && (!column.type || field.type === column.type))
    )
      return column
    const { [sourceId]: _missing, ...bind } = column.bind
    return { ...column, bind }
  })
}

export function exactStatusOptions(
  state: SourceQueryEditorState | undefined,
  pointer: string | undefined,
): { id: string; label: string }[] {
  if (!state?.description || !pointer) return []
  const field = state.description.fields.find((candidate) => candidate.pointer === pointer)
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
