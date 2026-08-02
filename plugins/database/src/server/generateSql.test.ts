import { describe, expect, it } from 'vitest'
import type { DbSavedQuery } from '../shared/database'
import { buildSystemPrompt, GENERATE_MAX_CONTEXT_CHARS, SQL_SYSTEM_PREAMBLE, stripSqlFences } from './generateSql'

const example = (over: Partial<DbSavedQuery> = {}): DbSavedQuery => ({
  id: 'q1',
  name: 'recent paid orders',
  notes: 'excludes refunds',
  sql: 'SELECT * FROM orders WHERE status = 1;',
  updatedAt: 0,
  ...over,
})

describe('buildSystemPrompt', () => {
  it('embeds the strict instruction and the schema text', () => {
    const prompt = buildSystemPrompt('CREATE TABLE "public"."users" ();')
    expect(prompt).toContain('Return ONLY a single valid PostgreSQL query.')
    expect(prompt).toContain(SQL_SYSTEM_PREAMBLE)
    expect(prompt).toContain('CREATE TABLE "public"."users" ();')
  })

  it('omits the notes and examples sections when there is nothing to add', () => {
    const prompt = buildSystemPrompt('SCHEMA', { notes: '   ', examples: [] })
    expect(prompt).not.toContain('Schema notes')
    expect(prompt).not.toContain('Example queries')
    expect(prompt.endsWith('SCHEMA')).toBe(true)
  })

  it('appends the repo schema notes', () => {
    const prompt = buildSystemPrompt('SCHEMA', { notes: 'orders.meta jsonb holds { coupon }' })
    expect(prompt).toContain('Schema notes:\n\norders.meta jsonb holds { coupon }')
  })

  it('renders each example as name + notes comments above its SQL', () => {
    const prompt = buildSystemPrompt('SCHEMA', { examples: [example()] })
    expect(prompt).toContain('Example queries')
    expect(prompt).toContain('-- recent paid orders\n-- excludes refunds\nSELECT * FROM orders WHERE status = 1;')
  })

  it('comments out every line of multi-line example notes', () => {
    const prompt = buildSystemPrompt('SCHEMA', { examples: [example({ notes: 'line one\nline two' })] })
    expect(prompt).toContain('-- line one\n-- line two')
  })

  it('skips an example with no SQL, and needs no notes', () => {
    const prompt = buildSystemPrompt('SCHEMA', { examples: [example({ sql: '  ' }), example({ id: 'q2', name: 'plain', notes: null })] })
    expect(prompt).not.toContain('recent paid orders')
    expect(prompt).toContain('-- plain\nSELECT * FROM orders WHERE status = 1;')
  })

  it('truncates notes + examples as one block, leaving the schema intact', () => {
    const prompt = buildSystemPrompt('SCHEMA', {
      notes: 'n'.repeat(GENERATE_MAX_CONTEXT_CHARS),
      examples: [example({ name: 'dropped-example' })],
    })
    expect(prompt).toContain('SCHEMA')
    expect(prompt).not.toContain('dropped-example')
    expect(prompt.length).toBeLessThanOrEqual(SQL_SYSTEM_PREAMBLE.length + 'SCHEMA'.length + GENERATE_MAX_CONTEXT_CHARS + 40)
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
