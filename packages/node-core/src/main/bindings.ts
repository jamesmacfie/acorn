import type { HttpBindings } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { type AppDatabase, schema } from '../server/db'
import type { CapabilityRegistry } from '../server/plugin/capabilities'
import { activeIdentityStore, type ActiveIdentityStore } from './activeIdentity'
import { ensureBoundIdentity } from './core/identity/identity'
import { deviceService, type DeviceService } from '../server/auth/deviceTokens'
import { idempotencyStore, type IdempotencyStore } from '../server/auth/idempotency'
import { pairingCodes, type PairingCodes } from '../server/auth/pairingCodes'
import { SecretService } from './core/secrets'
import { drizzleOverSqlite, openSqlite } from './sqlite'
import { ensureSessionKey } from './sessionKey'
import { ensureCert } from './tls'

// The runtime object the routes read via c.env (typed as the global Env in env.d.ts). Built once
// at startup and handed to the Hono app at the single app.fetch() seam in main/server.ts.
export type RuntimeBindings = {
  DB: AppDatabase
  // This node's data root. It lives on c.env because `POST /v2/core/backup` has to enumerate
  // `plugins/*.sqlite` beside core.sqlite (main/backup.ts), and a filesystem path carries no
  // secret: every child process this node spawns already receives it as ACORN_DATA_DIR, and
  // pluginStorage computes it from the same value. The alternative, a dedicated bridge slot, would
  // be three files for one string.
  DATA_DIR: string
  // This Node's durable identity, minted into node.json on first start (main/dataRoot.ts). Every
  // resource a client caches is keyed (nodeId, id), so two nodes holding the same UUID never
  // collide (docs/architecture-overview.md § Fleet semantics).
  NODE_ID: string
  // The sha256 of this node's TLS certificate, the value a client pins (docs/api-reference.md §
  // Pairing), advertised at GET /v2/node.
  //
  // The fingerprint, not the certificate and not the private key: c.env reaches every core and
  // plugin route, so anything placed here is readable by all of them. The key material stays
  // inside main/tls.ts and main/server.ts, which are the only modules that need it.
  NODE_FINGERPRINT: string
  // The app version this node is running, reported at GET /v2/node to an authenticated caller
  // (docs/api-reference.md § Versioning). Injected rather than read from a package.json, because the
  // service is a bundled artifact by then and only the composition root knows the real version.
  APP_VERSION: string
  BLOBS: BlobCache
  SESSION_ENC_KEY: string
  // Use-scoped credential access (main/core/secrets.ts). It replaces the raw SESSION_ENC_KEY that
  // used to sit here directly, and it is the seam that scrubs a credential out of a provider error
  // before it reaches a log or a client.
  SECRETS: SecretService
  // Bearer for loopback callers with no device token: the acorn MCP server and other spawned
  // children (docs/mcp.md § Launch environment). Injected into task session env as
  // ACORN_API_TOKEN; auth middleware maps it to the machine's single owner.
  INTERNAL_TOKEN: string
  // The machine's bound owner identity: an opaque `owner-<uuid>` minted at first boot
  // (ensureBoundIdentity below), read by every principal. Installs that bound a GitHub login under
  // the old scheme keep that login as the opaque id, with no data rewrite. Providers never bind.
  ACTIVE_IDENTITY: ActiveIdentityStore
  // Node auth root (docs/api-reference.md § Pairing): paired devices and their revocable bearer
  // tokens, the replay store behind Idempotency-Key, and the one-time pairing window.
  DEVICES: DeviceService
  IDEMPOTENCY: IdempotencyStore
  PAIRING_CODES: PairingCodes
  // Route handlers receive only this late-binding read surface. It keeps the per-runtime registry
  // out of the plugin host while allowing a request to resolve the provider that was initialized
  // for this node. The resolver exposes no registration or enumeration methods to routes, only get
  // and require.
  CAPABILITIES: Pick<CapabilityRegistry, 'get' | 'require'>
}

// What routes actually see as `c.env`: an ordinary exported type that travels with the import graph
// so every package compiling a route can use the same bindings contract.
//
// HttpBindings is Partial because the @hono/node-server adapter only spreads raw incoming/outgoing
// at the app.fetch() seam (main/server.ts); tests and non-HTTP callers don't provide them.
export type Env = RuntimeBindings & Partial<HttpBindings>

// Immutable blob and patch bodies keyed by sha (docs/caching.md § Immutable blob cache). One file
// per key under `dir`; keys are `filebody:<sha>` and `patch:<sha>`, with the colon sanitized for a
// safe filename.
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

const electronResourcesPath = (process as { resourcesPath?: string }).resourcesPath
const migrationsFolder = (() => {
  const packaged = electronResourcesPath ? join(electronResourcesPath, 'migrations') : null
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

export function openDb(dbPath: string): AppDatabase {
  const databasePath = resolve(dbPath)
  const dataDir = dirname(databasePath)
  mkdirSync(dataDir, { recursive: true, mode: 0o700 }) // SQLite won't create parent dirs
  chmodSync(dataDir, 0o700) // migrate an existing installation created under a permissive umask
  // Pre-create the database privately. SQLite derives WAL/SHM permissions from the database file,
  // so hardening before journal_mode prevents newly-created sidecars inheriting 0644.
  closeSync(openSync(databasePath, 'a', 0o600))
  chmodSync(databasePath, 0o600)
  const sqlite = openSqlite(databasePath)
  // WAL for concurrent read/write, and a short busy timeout instead of immediate SQLITE_BUSY.
  // No foreign_keys pragma: the schema declares no FK constraints (docs/data-layer.md), so
  // enabling enforcement would be a misleading no-op. main/sqlite.ts holds it off explicitly,
  // because node:sqlite would otherwise enable it by default where better-sqlite3 did not.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')

  // Drizzle's own better-sqlite3 session, over a node:sqlite handle that presents the same shape
  // (main/sqlite.ts explains why this does not go through drizzle's `drizzle()` front door).
  const db = drizzleOverSqlite(sqlite, schema)
  migrate(db, { migrationsFolder })
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) chmodSync(path, 0o600)
  }

  // `.batch([...])` (which this driver lacks) as a synchronous, all-or-nothing transaction.
  // Statements are built on `db`, so they run on this connection inside the BEGIN/COMMIT, keeping
  // the route call sites untouched.
  const withBatch = db as unknown as AppDatabase
  withBatch.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
    db.transaction((_tx) => statements.map((stmt) => stmt.run()))) as AppDatabase['batch']
  withBatch.close = () => sqlite.close()
  return withBatch
}

// Persist the loopback bearer across boots (docs/mcp.md § Launch environment). Store it next to
// the database (like session.key, mode 0600), reuse it, and mint one only on first run.
function loadOrCreateInternalToken(dataDir: string): string {
  const file = join(dataDir, 'internal-token')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (existing) {
      chmodSync(file, 0o600)
      return existing
    }
  } catch {
    // not created yet, so fall through and mint one
  }
  const token = randomUUID()
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  chmodSync(dataDir, 0o700)
  writeFileSync(file, token, { mode: 0o600 })
  chmodSync(file, 0o600)
  return token
}

export type BindingsOptions = {
  dbPath: string
  blobsDir: string
  nodeId: string
  appVersion: string
  capabilities: Pick<CapabilityRegistry, 'get' | 'require'>
}

// Build the bindings object once at startup. Electron resolves the data root in electron.ts
// (app.getPath('userData') when packaged, the repo-local apps/node/.acorn in dev) and passes
// the paths in; the standalone entry takes ACORN_DATA_DIR or that same dev root.
export function makeBindings({ dbPath, blobsDir, nodeId, appVersion, capabilities }: BindingsOptions): RuntimeBindings {
  const databasePath = resolve(dbPath)
  const blobCachePath = resolve(blobsDir)
  const db = openDb(databasePath)
  const dataDir = dirname(databasePath)
  // Was a required environment variable that threw at boot. It still wins when set, since the
  // desktop puts a safeStorage-backed value there before this runs, but a headless node now mints
  // its own into the data root instead of refusing to start (main/sessionKey.ts).
  const encKey = ensureSessionKey(dataDir)
  const activeIdentity = activeIdentityStore(dataDir)
  // Mint the owner id on first boot and adopt any pre-identity ''-scoped rows. Before this ran at
  // boot, the identity was bound as a side effect of connecting GitHub, and every internal caller
  // (MCP, agents) failed closed until then.
  ensureBoundIdentity(db, activeIdentity)
  return {
    DB: db,
    DATA_DIR: dataDir,
    NODE_ID: nodeId,
    // ensureCert is idempotent, so calling it here and in startListener does not mint two
    // certificates. It reads the same one twice, which is what lets the routes hold the public
    // fingerprint without the bindings ever touching the private key.
    NODE_FINGERPRINT: ensureCert(dataDir).fingerprint,
    APP_VERSION: appVersion,
    BLOBS: diskBlobCache(blobCachePath),
    SESSION_ENC_KEY: encKey,
    SECRETS: new SecretService(encKey),
    INTERNAL_TOKEN: loadOrCreateInternalToken(dataDir),
    ACTIVE_IDENTITY: activeIdentity,
    DEVICES: deviceService(db),
    IDEMPOTENCY: idempotencyStore(db),
    PAIRING_CODES: pairingCodes(),
    CAPABILITIES: capabilities,
  }
}
