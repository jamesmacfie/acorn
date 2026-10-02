import type { DataTable } from './data'
import type { DataPoolEntry } from './dataPools'

type CatalogRow = {
  table_schema: string
  table_name: string
  column_name: string | null
  data_type: string
  is_nullable: string
  is_pk: boolean
}

// information_schema owns table and column visibility, including column-only grants. The PK lookup
// uses the same pg_index membership as the former per-table query, without widening visibility.
const CATALOG_SQL = `SELECT t.table_schema, t.table_name, c.column_name, c.data_type, c.is_nullable,
  EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = pg_catalog.to_regclass(format('%I.%I', t.table_schema, t.table_name))
      AND i.indisprimary AND a.attname = c.column_name) AS is_pk
  FROM information_schema.tables t
  LEFT JOIN information_schema.columns c
    ON c.table_schema = t.table_schema AND c.table_name = t.table_name
  WHERE t.table_type = 'BASE TABLE' AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY t.table_schema, t.table_name, c.ordinal_position`

export function invalidateDataCatalog(entry: DataPoolEntry): void {
  entry.schemaVersion++
  entry.catalog = undefined
  entry.catalogWave = undefined
}

export async function dataCatalog(entry: DataPoolEntry): Promise<DataTable[]> {
  if (entry.catalog) return entry.catalog
  if (entry.catalogWave) return entry.catalogWave
  const version = entry.schemaVersion
  const wave = entry.pool.query<CatalogRow>(CATALOG_SQL).then(({ rows }) => {
    if (entry.retired || entry.schemaVersion !== version) throw new Error('Database catalog retired. Retry the schema read.')
    const tables: DataTable[] = []
    for (const row of rows) {
      let table = tables[tables.length - 1]
      if (!table || table.schema !== row.table_schema || table.name !== row.table_name) {
        table = { schema: row.table_schema, name: row.table_name, columns: [] }
        tables.push(table)
      }
      if (row.column_name !== null) table.columns.push({
        name: row.column_name, dataType: row.data_type, nullable: row.is_nullable === 'YES', isPk: row.is_pk,
      })
    }
    entry.catalog = tables
    return tables
  })
  entry.catalogWave = wave
  try { return await wave }
  finally { if (entry.catalogWave === wave) entry.catalogWave = undefined }
}
