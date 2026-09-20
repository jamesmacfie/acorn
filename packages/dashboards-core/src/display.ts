import type { DataRecordAction } from '@acorn/protocol/dataActions.ts'

/** Dashboard-only projection types. Source plugins never register or return these shapes. */
export type DashboardDisplayFieldType = 'text' | 'number' | 'boolean' | 'datetime' | 'enum' | 'person' | 'link'
export type DashboardDisplayFieldRole = 'title' | 'status' | 'assignee' | 'url' | 'updated'
export type DashboardDisplayTone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'
export type DashboardDisplayChoice = { id: string; label: string; tone?: DashboardDisplayTone; icon?: string }
export type DashboardDisplayField = {
  id: string
  name: string
  type: DashboardDisplayFieldType
  role?: DashboardDisplayFieldRole
  unit?: string
  values?: DashboardDisplayChoice[]
}
export type DashboardDisplaySchema = { fields: DashboardDisplayField[] }
export type DashboardDisplayCell = string | number | boolean | null
export type DashboardDisplayRow = {
  id: string
  values: Record<string, DashboardDisplayCell>
  pluginId: string
  /** Internal projection key. It identifies one query instance, not a registered source. */
  sourceId: string
  sourceRowId?: string
  taskId?: string
  action?: DataRecordAction
}
