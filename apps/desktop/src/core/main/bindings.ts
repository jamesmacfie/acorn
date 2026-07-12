import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { type AppDatabase, schema } from '../server/db'
import { OauthAccountService } from '../server/publicApi/oauthAccountService'
import { TokenService } from '../server/publicApi/tokenService'
import { UiControlBroker } from './publicApi/uiControlBroker'

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
  // Public automation API services (docs/public-api.md). Singletons so the internal admin routes (4317),
  // the public listener, and the WS hub share one TokenService instance — revocation listeners must
  // survive across requests.
  API_TOKENS: TokenService
  OAUTH_ACCOUNTS: OauthAccountService
  // UI control broker (docs/public-api.md): one control connection per renderer window on the 4317
  // socket; the public command dispatch crosses presentation commands through it.
  UI_BROKER: UiControlBroker
}

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
  mkdirSync(dirname(dbPath), { recursive: true }) // better-sqlite3 won't create parent dirs
  const Database = loadDatabase()
  const sqlite = new Database(dbPath)
  // WAL for concurrent read/write, and a short busy timeout instead of immediate SQLITE_BUSY.
  // No foreign_keys pragma: the schema declares no FK constraints (docs/data-layer.md), so
  // enabling enforcement would be a misleading no-op.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  // `.batch([...])` (which better-sqlite3 lacks) as a synchronous transaction — all-or-nothing
  // semantics. Statements are built on `db`, so they run on this connection inside the
  // BEGIN/COMMIT, keeping the route call sites untouched.
  const withBatch = db as unknown as AppDatabase
  withBatch.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
    db.transaction((_tx) => statements.map((stmt) => stmt.run()))) as AppDatabase['batch']
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
    if (existing) return existing
  } catch {
    // not created yet — fall through and mint one
  }
  const token = randomUUID()
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, token, { mode: 0o600 })
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
  const db = openDb(dbPath)
  const encKey = secret('SESSION_ENC_KEY')
  return {
    DB: db,
    OAUTH_STATE: oauthStateStore(),
    BLOBS: diskBlobCache(blobsDir),
    SESSION_ENC_KEY: encKey,
    GITHUB_CLIENT_ID: secret('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: secret('GITHUB_CLIENT_SECRET'),
    INTERNAL_TOKEN: loadOrCreateInternalToken(dirname(dbPath)),
    API_TOKENS: new TokenService(db),
    OAUTH_ACCOUNTS: new OauthAccountService(db, encKey),
    UI_BROKER: new UiControlBroker(),
  }
}
