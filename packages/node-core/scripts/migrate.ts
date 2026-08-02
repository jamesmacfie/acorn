// Apply Drizzle migrations to the local SQLite DB without launching the app. The app also migrates
// on startup (openDb runs migrate), so this is mainly for CI / pre-package / explicit dev runs.
// Usage: pnpm db:migrate   (override path with ACORN_DB_PATH)
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/main/bindings.ts'
import { resolveDatabasePath, resolveServerPaths } from '../src/main/serverPaths.ts'

const { devDataDir } = resolveServerPaths(dirname(fileURLToPath(import.meta.url)))
const dbPath = process.env.ACORN_DB_PATH ?? resolveDatabasePath(devDataDir)
openDb(dbPath) // opens + migrates
console.log(`migrated ${dbPath}`)
