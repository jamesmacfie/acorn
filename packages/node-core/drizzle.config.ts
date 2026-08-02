import { defineConfig } from 'drizzle-kit'

// generate-only: emits SQL migrations from the schema (no DB connection needed here). Applied to
// the local SQLite DB by `pnpm db:migrate` (scripts/migrate.ts) and on app startup (openDb).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/server/db/schema.ts',
  out: './migrations',
})
