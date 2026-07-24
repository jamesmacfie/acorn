// Prompt construction + response cleanup for AI SQL generation (docs/pg.md). Pure functions so the
// contract with the model — "the reply IS the query" — is unit-testable without a provider.

export const GENERATE_MAX_OUTPUT_TOKENS = 2048
export const GENERATE_MAX_PROMPT_CHARS = 4000

export const SQL_SYSTEM_PREAMBLE = [
  'You write PostgreSQL for a database whose schema is given below.',
  'Return ONLY a single valid PostgreSQL query.',
  'Do not wrap it in markdown code fences. Do not add prose, comments, or explanation.',
  'Your entire reply must be executable as-is by PostgreSQL.',
].join(' ')

export function buildSystemPrompt(schemaText: string): string {
  return `${SQL_SYSTEM_PREAMBLE}\n\nDatabase schema:\n\n${schemaText}`
}

// Models occasionally fence the reply despite instructions — unwrap ``` / ```sql defensively.
export function stripSqlFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[a-zA-Z]*\r?\n?([\s\S]*?)\r?\n?```$/)
  return (match ? match[1] : trimmed).trim()
}
