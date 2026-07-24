import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, SQL_SYSTEM_PREAMBLE, stripSqlFences } from './generateSql'

describe('buildSystemPrompt', () => {
  it('embeds the strict instruction and the schema text', () => {
    const prompt = buildSystemPrompt('CREATE TABLE "public"."users" ();')
    expect(prompt).toContain('Return ONLY a single valid PostgreSQL query.')
    expect(prompt).toContain(SQL_SYSTEM_PREAMBLE)
    expect(prompt).toContain('CREATE TABLE "public"."users" ();')
  })
})

describe('stripSqlFences', () => {
  it('passes plain SQL through trimmed', () => {
    expect(stripSqlFences('  SELECT 1;  \n')).toBe('SELECT 1;')
  })

  it('unwraps ```sql fences', () => {
    expect(stripSqlFences('```sql\nSELECT * FROM users;\n```')).toBe('SELECT * FROM users;')
  })

  it('unwraps bare ``` fences with surrounding whitespace', () => {
    expect(stripSqlFences('\n```\nSELECT 1;\n```\n')).toBe('SELECT 1;')
  })

  it('leaves fences mid-text alone', () => {
    const text = "SELECT '```' AS fence;"
    expect(stripSqlFences(text)).toBe(text)
  })
})
