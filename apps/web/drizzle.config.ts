import { defineConfig } from 'drizzle-kit'

// generate-only: emits SQL migrations from the schema. Applied to local D1 via
// `wrangler d1 migrations apply gurthurd --local` (no DB connection needed here).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './migrations',
})
