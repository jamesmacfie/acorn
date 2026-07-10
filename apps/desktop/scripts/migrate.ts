// Apply Drizzle migrations to the local SQLite DB without launching the app. The app also migrates
// on startup (openDb runs migrate), so this is mainly for CI / pre-package / explicit dev runs.
// Usage: pnpm --filter @acorn/desktop db:migrate   (override path with ACORN_DB_PATH)
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/core/main/bindings'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.ACORN_DB_PATH ?? resolve(root, '.acorn/acorn.sqlite')
openDb(dbPath) // opens + migrates
console.log(`migrated ${dbPath}`)
