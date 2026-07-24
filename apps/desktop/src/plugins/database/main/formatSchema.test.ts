import { describe, expect, it } from 'vitest'
import { formatSchema } from './database'

describe('formatSchema', () => {
  it('renders NOT NULL, PK markers, and multi-schema table names', () => {
    const text = formatSchema([
      {
        schema: 'public',
        name: 'users',
        columns: [
          { name: 'id', dataType: 'integer', nullable: false, isPk: true },
          { name: 'email', dataType: 'text', nullable: false, isPk: false },
          { name: 'deleted_at', dataType: 'timestamp with time zone', nullable: true, isPk: false },
        ],
      },
      {
        schema: 'audit',
        name: 'events',
        columns: [{ name: 'id', dataType: 'bigint', nullable: false, isPk: true }],
      },
    ])

    expect(text).toBe([
      'CREATE TABLE "public"."users" (',
      '  "id" integer NOT NULL, -- PK',
      '  "email" text NOT NULL,',
      '  "deleted_at" timestamp with time zone,',
      ');',
      '',
      'CREATE TABLE "audit"."events" (',
      '  "id" bigint NOT NULL, -- PK',
      ');',
    ].join('\n'))
  })
})
