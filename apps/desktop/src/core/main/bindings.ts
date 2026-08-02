import type { HttpBindings } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { type AppDatabase, schema } from '../server/db'
import { activeIdentityStore, type ActiveIdentityStore } from './activeIdentity'

// The runtime object the routes read via c.env (typed as the global Env in env.d.ts). Built once
// at startup and handed to the Hono app at the single app.fetch() seam in main/server.ts.
export type RuntimeBindings = {
  DB: AppDatabase
  OAUTH_STATE: OauthStateStore
  BLOBS: BlobCache
  SESSION_ENC_KEY: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  // Per-app-run bearer for loopback callers that hold no session cookie — the acorn MCP server
  // (docs/mcp.md). Injected into task session env (ACORN_API_TOKEN) so agent-spawned servers
  // inherit it; auth middleware maps it to the machine's single user.
  INTERNAL_TOKEN: string
  // Explicit identity bound to INTERNAL_TOKEN. Cookie-authenticated traffic updates it; logout
  // clears it. Machine callers fail closed when no identity is bound instead of selecting an
  // arbitrary cached prefs/repo row.
  ACTIVE_IDENTITY: ActiveIdentityStore
}

// What routes actually see as `c.env`. Was an ambient `declare global { interface Env }` in
// src/env.d.ts; that only worked because the whole app was one TypeScript program. Under the vNext
// package split each package compiles with `include: ["src"]`, so an ambient global declared in
// node-core would be invisible to the twenty plugin packages whose routes read c.env — hence an
// ordinary exported type that travels with the import graph.
//
// HttpBindings is Partial because the @hono/node-server adapter only spreads raw incoming/outgoing
// at the app.fetch() seam (main/server.ts); tests and non-HTTP callers don't provide them.
export type Env = RuntimeBindings & Partial<HttpBindings>

// One-time OAuth CSRF states (docs/authentication.md): /auth/login issues a state, /auth/callback
// consumes it. TTL is internal — states are short-lived and never persisted.
export type OauthStateStore = {
  issue(state: string): void
  // True when the state was live (issued, unexpired, not yet consumed). Consuming removes it.
  consume(state: string): boolean
}

// In-memory with lazy expiry. The TTL matches the /auth state cookie's maxAge (routes/auth.ts).
const OAUTH_STATE_TTL_MS = 5 * 60_000
export function oauthStateStore(ttlMs = OAUTH_STATE_TTL_MS): OauthStateStore {
  const store = new Map<string, number>() // state → expiresAt
  return {
    issue(state) {
      store.set(state, Date.now() + ttlMs)
    },
    consume(state) {
      const expiresAt = store.get(state)
      if (expiresAt == null) return false
      store.delete(state)
      return expiresAt >= Date.now()
    },
  }
}

// Immutable blob/patch bodies keyed by sha (docs/caching.md) — content never changes for a key, so
// there is no TTL and no delete. One file per key under `dir`; keys are `filebody:<sha>` /
// `patch:<sha>` — sanitize the colon for a safe filename.
export type BlobCache = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export function diskBlobCache(dir: string): BlobCache {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  // Migrate existing cache entries created under a permissive umask. Never follow symlinks: blob
  // keys create flat regular files, so anything else is outside this cache's contract.
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    try {
      if (lstatSync(path).isFile()) chmodSync(path, 0o600)
    } catch {
      // A cache file can disappear concurrently; a later miss simply refetches it.
    }
  }
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
      const path = fileFor(key)
      await writeFile(path, value, { encoding: 'utf8', mode: 0o600 })
      chmodSync(path, 0o600) // writeFile preserves an existing inode's prior mode
    },
  }
}

// drizzle-generated migrations: packaged as extraResources (process.resourcesPath/migrations) in a
// built app, else resolved from this module at apps/desktop/migrations. Never from process.cwd().
// ponytail: search ancestors for the migrations dir instead of a fixed `../../` — the module sits at
// a different depth in the built bundle (out/main) vs dev/test source (src/core/main), so a fixed
// relative path can't serve both. First `migrations` dir up the tree is apps/desktop/migrations.
const migrationsFolder = (() => {
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'migrations') : null
  if (packaged && existsSync(packaged)) return packaged
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const cand = join(dir, 'migrations')
    if (existsSync(cand)) return cand
    const parent = dirname(dir)
    if (parent === dir) return resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')
    dir = parent
  }
})()

// better-sqlite3 is a native module built for ONE ABI at a time (Electron vs Node — see
// docs/local-development.md). Load it lazily so an ABI mismatch surfaces as an actionable error
// naming the right rebuild script, instead of a bare NODE_MODULE_VERSION stack at import time.
const nodeRequire = createRequire(import.meta.url)
function loadDatabase(): typeof import('better-sqlite3') {
  try {
    return nodeRequire('better-sqlite3') as typeof import('better-sqlite3')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('NODE_MODULE_VERSION') || msg.includes('was compiled against a different Node.js version')) {
      const fix = process.versions.electron
        ? 'pnpm --filter @acorn/desktop electron:rebuild (this is an Electron process)'
        : 'pnpm --filter @acorn/desktop node:rebuild (this is a plain Node process)'
      throw new Error(`better-sqlite3 is built for the wrong ABI. Run: ${fix}\n\nOriginal error: ${msg}`)
    }
    throw e
  }
}

export function openDb(dbPath: string): AppDatabase {
  const databasePath = resolve(dbPath)
  const dataDir = dirname(databasePath)
  mkdirSync(dataDir, { recursive: true, mode: 0o700 }) // better-sqlite3 won't create parent dirs
  chmodSync(dataDir, 0o700) // migrate an existing installation created under a permissive umask
  // Pre-create the database privately. SQLite derives WAL/SHM permissions from the database file,
  // so hardening before journal_mode prevents newly-created sidecars inheriting 0644.
  closeSync(openSync(databasePath, 'a', 0o600))
  chmodSync(databasePath, 0o600)
  const Database = loadDatabase()
  const sqlite = new Database(databasePath)
  // WAL for concurrent read/write, and a short busy timeout instead of immediate SQLITE_BUSY.
  // No foreign_keys pragma: the schema declares no FK constraints (docs/data-layer.md), so
  // enabling enforcement would be a misleading no-op.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) chmodSync(path, 0o600)
  }

  // `.batch([...])` (which better-sqlite3 lacks) as a synchronous transaction — all-or-nothing
  // semantics. Statements are built on `db`, so they run on this connection inside the
  // BEGIN/COMMIT, keeping the route call sites untouched.
  const withBatch = db as unknown as AppDatabase
  withBatch.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
    db.transaction((_tx) => statements.map((stmt) => stmt.run()))) as AppDatabase['batch']
  withBatch.close = () => sqlite.close()
  return withBatch
}

// Persist the loopback bearer across boots (docs/mcp.md): agent panes run in tmux and are
// reattached after an acorn restart, so the `claude` process keeps the ACORN_API_TOKEN from the
// boot that spawned it. A per-boot random token would 404 every reattached session's MCP / notes /
// memory / context calls ("connected · no tools" after a relaunch). Store it next to the DB (like
// session.key, 0600) and reuse it; create on first run.
function loadOrCreateInternalToken(dataDir: string): string {
  const file = join(dataDir, 'internal-token')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (existing) {
      chmodSync(file, 0o600)
      return existing
    }
  } catch {
    // not created yet — fall through and mint one
  }
  const token = randomUUID()
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  chmodSync(dataDir, 0o700)
  writeFileSync(file, token, { mode: 0o600 })
  chmodSync(file, 0o600)
  return token
}

export type BindingsOptions = { dbPath: string; blobsDir: string }

// Build the bindings object once at startup. Electron resolves the data root in electron.ts
// (app.getPath('userData') when packaged, the repo-local apps/desktop/.acorn in dev) and passes
// the paths in; the Node-only entry (dev:node) defaults to the repo-local dir in server.ts.
export function makeBindings({ dbPath, blobsDir }: BindingsOptions): RuntimeBindings {
  const secret = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var ${name} (set it in .env or the environment)`)
    return value
  }
  const databasePath = resolve(dbPath)
  const blobCachePath = resolve(blobsDir)
  const db = openDb(databasePath)
  const encKey = secret('SESSION_ENC_KEY')
  const dataDir = dirname(databasePath)
  return {
    DB: db,
    OAUTH_STATE: oauthStateStore(),
    BLOBS: diskBlobCache(blobCachePath),
    SESSION_ENC_KEY: encKey,
    GITHUB_CLIENT_ID: secret('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: secret('GITHUB_CLIENT_SECRET'),
    INTERNAL_TOKEN: loadOrCreateInternalToken(dataDir),
    ACTIVE_IDENTITY: activeIdentityStore(dataDir),
  }
}
