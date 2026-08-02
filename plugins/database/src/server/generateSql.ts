// Prompt construction + response cleanup for AI SQL generation (docs/pg.md). Pure functions so the
// contract with the model — "the reply IS the query" — is unit-testable without a provider.

import type { DbSavedQuery } from '../shared/database'

export const GENERATE_MAX_OUTPUT_TOKENS = 2048
// Budget for the notes + examples block. The schema itself is capped at SCHEMA_CHAR_CAP (80k) in
// main/database.ts, so 80k + 16k stays under the model runtime's MAX_SYSTEM_CHARS (100k).
export const GENERATE_MAX_CONTEXT_CHARS = 16_000

export const SQL_SYSTEM_PREAMBLE = [
  'You write PostgreSQL for a database whose schema is given below.',
  'Return ONLY a single valid PostgreSQL query.',
  'Do not wrap it in markdown code fences. Do not add prose, comments, or explanation.',
  'Your entire reply must be executable as-is by PostgreSQL.',
].join(' ')

// The schema is always sent; the repo's free-form notes (facts the schema can't express) and any
// saved queries the user picked as worked examples are appended when present. Notes + examples share
// one char budget, truncated as a block — schema fidelity matters more than the last example.
export function buildSystemPrompt(schemaText: string, ctx?: { notes?: string; examples?: readonly DbSavedQuery[] }): string {
  const extras: string[] = []
  const notes = ctx?.notes?.trim()
  if (notes) extras.push(`Schema notes:\n\n${notes}`)
  const examples = (ctx?.examples ?? []).filter((q) => q.sql.trim())
  if (examples.length) {
    const rendered = examples
      .map((q) => [`-- ${q.name}`, ...(q.notes?.trim() ? [`-- ${q.notes.trim().replace(/\n/g, '\n-- ')}`] : []), q.sql.trim()].join('\n'))
      .join('\n\n')
    extras.push(`Example queries — hand-written and known-correct for this database:\n\n${rendered}`)
  }
  const context = extras.join('\n\n').slice(0, GENERATE_MAX_CONTEXT_CHARS)
  return `${SQL_SYSTEM_PREAMBLE}\n\nDatabase schema:\n\n${schemaText}${context ? `\n\n${context}` : ''}`
}

// Models occasionally fence the reply despite instructions — unwrap ``` / ```sql defensively.
export function stripSqlFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[a-zA-Z]*\r?\n?([\s\S]*?)\r?\n?```$/)
  return (match ? match[1] : trimmed).trim()
}
