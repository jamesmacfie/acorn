import type { DataRecordAction, NamedDataRecordAction } from '@acorn/protocol/dataActions.ts'
import type { DataRecordRef } from '@acorn/protocol/dataSources.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { PlanRecordItem } from './plan'

/** Dashboard-only projection types. Source plugins never register or return these shapes. */
export type DashboardDisplayFieldType = 'text' | 'number' | 'boolean' | 'datetime' | 'enum' | 'person' | 'link'
export type DashboardDisplayFieldRole = 'title' | 'status' | 'assignee' | 'url' | 'updated'
export type DashboardDisplayTone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'
export type DashboardDisplayChoice = { id: string; label: string; tone?: DashboardDisplayTone; rank?: number; icon?: string }
export type DashboardDisplayField = {
  id: string
  name: string
  type: DashboardDisplayFieldType
  role?: DashboardDisplayFieldRole
  unit?: string
  precision?: 'instant' | 'day'
  zone?: string
  list?: boolean
  values?: DashboardDisplayChoice[]
  /** Table and list views skip it. Other views still read it. */
  hidden?: boolean
}
export type DashboardDisplaySchema = { fields: DashboardDisplayField[] }
export type DashboardDisplayCell = string | number | boolean | null | (string | number | boolean | null)[]
export type DashboardDisplayRow = {
  id: string
  values: Record<string, DashboardDisplayCell>
  units?: Record<string, string>
  pluginId: string
  /** Internal projection key. It identifies one query instance, not a registered source. */
  sourceId: string
  sourceRowId?: string
  taskId?: string
  action?: DataRecordAction
  actions?: NamedDataRecordAction[]
  records?: DataRecordRef[]
  sourceFieldValues?: Record<string, Record<string, DataValue>>
  sourceWritableFields?: Record<string, string[]>
  recordItems?: PlanRecordItem[]
  target?: { kind: string; item: string }
  partial?: Record<string, string>
  summaryStage?: number
  correctableDatasetId?: string
}
