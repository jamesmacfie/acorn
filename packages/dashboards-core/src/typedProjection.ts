import type { DashboardMapping, DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import type { DataField } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription, DataSourceQuery, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { PanelDefinition, PanelMapping, PanelProjectionSource, PanelView } from './model'
import { panelSourceKey } from './model'
import type { PanelSourcePage } from './mapping'
import { panelSchema, unionRows } from './mapping'
import { shapeRows, visibleFields } from './shaping'
import type { DashboardDisplayCell, DashboardDisplayField, DashboardDisplayRow } from './display'

export type DashboardQueryProjection = {
  instanceId: string
  label: string
  query: DataSourceQuery
  description: DataSourceDescription
  result: DataSourceResult
}

const primitiveType = (schema: DataSchema): string => Array.isArray(schema.type)
  ? schema.type.find(type => type !== 'null') ?? 'null'
  : schema.type

function schemaAtPointer(schema: DataSchema, pointer: string): DataSchema | undefined {
  if (!pointer) return schema
  const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current = schema
  for (const part of parts) {
    if (primitiveType(current) !== 'object') return undefined
    const nested = current.properties?.[part]
    if (!nested) return undefined
    current = nested
  }
  return current
}

function displayType(field: DataField, schema: DataSchema): DashboardDisplayField['type'] {
  const kind = field.display?.kind
  if (kind === 'status') return 'enum'
  if (kind) return kind
  switch (primitiveType(schema)) {
    case 'number':
    case 'integer': return 'number'
    case 'boolean': return 'boolean'
    default: return 'text'
  }
}

export function dashboardFields(description: DataSourceDescription): DashboardDisplayField[] {
  return description.fields.flatMap((field): DashboardDisplayField[] => {
    const schema = schemaAtPointer(description.schema, field.pointer)
    if (!schema) return []
    const type = displayType(field, schema)
    const values = type === 'enum' && field.choices?.kind === 'static'
      ? field.choices.values.map(value => ({ id: value.id, label: value.label }))
      : undefined
    return [{
      id: field.pointer,
      name: field.label,
      type,
      ...(field.display?.role ? { role: field.display.role } : {}),
      ...(field.display?.unit && type === 'number' ? { unit: field.display.unit } : {}),
      ...(values?.length ? { values } : {}),
    }]
  })
}

function cell(value: DataValue | typeof MISSING): DashboardDisplayCell {
  if (value === MISSING || value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

/** Query instances, not sources, own mapping identity. Two differently filtered reads of one source
 * must never share a status matrix merely because their provider/source pair matches. */
export const dashboardQuerySourceKey = (query: Pick<DataSourceQuery, 'source'>, instanceId: string): string =>
  panelSourceKey({ pluginId: query.source.pluginId, sourceId: `${query.source.sourceId}@${instanceId}` })

function panelSource(preview: DashboardQueryProjection): PanelProjectionSource {
  return {
    pluginId: preview.query.source.pluginId,
    sourceId: `${preview.query.source.sourceId}@${preview.instanceId}`,
  }
}

function sourceRows(preview: DashboardQueryProjection): DashboardDisplayRow[] {
  const fields = dashboardFields(preview.description)
  return preview.result.records.map(record => ({
    id: record.ref.recordId,
    values: Object.fromEntries(fields.map(field => [field.id, cell(readDataPointer(record.data, field.id))])),
    pluginId: record.ref.pluginId,
    sourceId: `${record.ref.sourceId}@${preview.instanceId}`,
    ...(record.taskId ? { taskId: record.taskId } : {}),
    ...(record.action ? { action: record.action } : {}),
  }))
}

function panelMapping(mapping: DashboardMapping, previews: readonly DashboardQueryProjection[]): PanelMapping | undefined {
  const fields: NonNullable<PanelMapping['fields']> = {}
  const bySource: NonNullable<PanelMapping['bySource']> = {}
  for (const preview of previews) {
    const key = dashboardQuerySourceKey(preview.query, preview.instanceId)
    if (mapping.fields[preview.instanceId]) fields[key] = { ...mapping.fields[preview.instanceId] }
    const values = mapping.values[preview.instanceId]
    if (values) bySource[key] = Object.fromEntries(Object.entries(values).map(([columnId, ids]) => [columnId, { values: [...ids] }]))
  }
  if (!mapping.columns.length && !Object.keys(fields).length && !Object.keys(bySource).length) return undefined
  return {
    columns: mapping.columns.map(column => ({ ...column })),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(Object.keys(bySource).length ? { bySource } : {}),
    ...(mapping.unmapped === 'hidden' ? { unmapped: 'hidden' } : {}),
  }
}

export function projectDashboardPanel(content: DashboardPanelContent, previews: readonly DashboardQueryProjection[]) {
  const projectedSources = previews.map(panelSource)
  const mapping = panelMapping(content.mapping, previews)
  const sources: PanelSourcePage[] = previews.map((preview, index) => ({
    source: projectedSources[index]!,
    schema: { fields: dashboardFields(preview.description) },
    rows: sourceRows(preview),
  }))
  const view: PanelView = { ...content.display.view }
  const definition: PanelDefinition = {
    id: 'dashboard-draft',
    title: content.title,
    sources: projectedSources,
    ...(mapping ? { mapping } : {}),
    shaping: {
      ...(content.display.fields.length ? { fields: content.display.fields } : {}),
      ...(content.display.groupBy ? { groupBy: content.display.groupBy } : {}),
      ...(content.display.limit ? { limit: content.display.limit } : {}),
    },
    view,
  }
  const schema = panelSchema(sources, mapping)
  const rows = shapeRows(unionRows(sources, mapping), schema, definition.shaping)
  return { definition, schema, fields: visibleFields(schema, definition.shaping), rows, sources }
}

/** Suggest category-named columns from preview data while retaining every exact provider status id. */
export function suggestStateCategoryMapping(
  preview: DashboardQueryProjection,
  statusPointer: string,
  categoryPointer: string,
): { columns: DashboardMapping['columns']; values: Record<string, string[]> } {
  const columns = new Map<string, { id: string; label: string }>()
  const values = new Map<string, Set<string>>()
  for (const record of preview.result.records) {
    const status = readDataPointer(record.data, statusPointer)
    const category = readDataPointer(record.data, categoryPointer)
    if (typeof status !== 'string' || typeof category !== 'string') continue
    const id = category
    if (!columns.has(id)) columns.set(id, { id, label: category })
    const exact = values.get(id) ?? new Set<string>()
    exact.add(status)
    values.set(id, exact)
  }
  return {
    columns: [...columns.values()],
    values: Object.fromEntries([...values].map(([id, exact]) => [id, [...exact]])),
  }
}
