import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { type AppDatabase, schema } from '../server/db'

// The runtime object the routes read via c.env. It mirrors the Workers `Env` shape closely
// enough that the server bootstrap can cast it to `Env` at the single app.fetch() seam.
export type RuntimeBindings = {
  DB: AppDatabase
  OAUTH_STATE: KVish
  BLOBS: KVish
  SESSION_ENC_KEY: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
}

// Only the KV methods the routes actually call — not the full Workers KV surface.
export type KVish = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

// OAUTH_STATE: 5-minute CSRF state. In-memory TTL map with lazy expiry — no persistence wanted.
function memoryKV(): KVish {
  const store = new Map<string, { value: string; expiresAt: number }>()
  return {
    async get(key) {
      const hit = store.get(key)
      if (!hit) return null
      if (hit.expiresAt && hit.expiresAt < Date.now()) {
        store.delete(key)
        return null
      }
      return hit.value
    },
    async put(key, value, options) {
      const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : 0
      store.set(key, { value, expiresAt })
    },
    async delete(key) {
      store.delete(key)
    },
  }
}

// BLOBS: immutable public blob/patch bodies keyed by sha. One file per key under `dir`.
// Keys are `filebody:<sha>` / `patch:<sha>` — sanitize the colon for a safe filename.
function diskKV(dir: string): KVish {
  mkdirSync(dir, { recursive: true })
  const fileFor = (key: string) => join(dir, key.replace(/[^a-zA-Z0-9._-]/g, '_'))
  return {
    async get(key) {
      try {
        return await readFile(fileFor(key), 'utf8')
      } catch {
        return null // ENOENT (cache miss) and any read error → treat as miss
      }
    },
    async put(key, value) {
      await writeFile(fileFor(key), value, 'utf8')
    },
    async delete(key) {
      await rm(fileFor(key), { force: true })
    },
  }
}

// drizzle-generated migrations live at apps/web/migrations; resolve from this module, not cwd.
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')

function openDb(dbPath: string): AppDatabase {
  mkdirSync(dirname(dbPath), { recursive: true }) // better-sqlite3 won't create parent dirs
  const sqlite = new Database(dbPath)
  // D1 hides these; better-sqlite3 does not. FK enforcement, WAL, and a short busy timeout.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  // Emulate D1's `.batch([...])` (which better-sqlite3 lacks) with a synchronous transaction —
  // same all-or-nothing semantics. Statements are built on `db`, so they run on this connection
  // inside the BEGIN/COMMIT. ponytail: one shim here keeps all 5 route call sites untouched.
  const withBatch = db as unknown as AppDatabase
  withBatch.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
    db.transaction((_tx) => statements.map((stmt) => stmt.run()))) as AppDatabase['batch']
  return withBatch
}

export type BindingsOptions = { dbPath: string; blobsDir: string }

// Build the bindings object once at startup. Electron (Phase 1) passes app.getPath('userData')
// paths; the defaults below are for the Node-only Phase 0 spike.
export function makeBindings({ dbPath, blobsDir }: BindingsOptions): RuntimeBindings {
  const secret = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var ${name} (load it via --env-file=.dev.vars)`)
    return value
  }
  return {
    DB: openDb(dbPath),
    OAUTH_STATE: memoryKV(),
    BLOBS: diskKV(blobsDir),
    SESSION_ENC_KEY: secret('SESSION_ENC_KEY'),
    GITHUB_CLIENT_ID: secret('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: secret('GITHUB_CLIENT_SECRET'),
  }
}
