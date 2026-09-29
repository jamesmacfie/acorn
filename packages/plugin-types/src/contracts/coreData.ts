export type DataCell = string | null
export type DataColumn = { name: string; dataType: string; nullable: boolean; isPk: boolean }
export type DataTable = { schema: string; name: string; columns: DataColumn[] }
export type DataSchemaSource = 'auto' | 'script' | 'file'
export type DataQueryOptions = {
  maxRows?: number
  readOnly?: boolean
  timeoutMs?: number
  parameters?: DataCell[]
}
export type DataQueryResult = {
  columns: string[]
  rows: DataCell[][]
  rowCount: number | null
  command: string
  truncated: boolean
  ms: number
}
export type DataSchemaResult = {
  tables: DataTable[]
  text: string
  source: DataSchemaSource
  notes?: string
}
export type CoreDataService = {
  connect(taskId: string): Promise<{ database: string }>
  disconnect(taskId: string): Promise<void>
  query(taskId: string, sql: string, options?: DataQueryOptions): Promise<DataQueryResult>
  catalog(taskId: string): Promise<DataTable[]>
  schema(taskId: string): Promise<DataSchemaResult>
}
