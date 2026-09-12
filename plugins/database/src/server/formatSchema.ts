// Schema text for the SQL-generation prompt, and the identifier quoting it and database.ts share.
import type { DbColumn } from '../shared/database'

export const qid = (id: string): string => `"${id.replace(/"/g, '""')}"`

// Compact CREATE TABLE-ish text from introspected tables, for the AI prompt rather than execution.
export function formatSchema(tables: { schema: string; name: string; columns: DbColumn[] }[]): string {
  return tables
    .map((t) => {
      const cols = t.columns
        .map((c) => `  ${qid(c.name)} ${c.dataType}${c.nullable ? '' : ' NOT NULL'}${c.isPk ? ', -- PK' : ','}`)
        .join('\n')
      return `CREATE TABLE ${qid(t.schema)}.${qid(t.name)} (\n${cols}\n);`
    })
    .join('\n\n')
}
