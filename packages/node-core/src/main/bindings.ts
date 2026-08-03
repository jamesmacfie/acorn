import type { HttpBindings } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { type AppDatabase, schema } from '../server/db'
import { activeIdentityStore, type ActiveIdentityStore } from './activeIdentity'
import { deviceService, type DeviceService } from '../server/auth/deviceTokens'
import { idempotencyStore, type IdempotencyStore } from '../server/auth/idempotency'
import { pairingCodes, type PairingCodes } from '../server/auth/pairingCodes'
import { SecretService } from './core/secrets'
import { loadDatabase } from './sqliteLoader'
import { ensureCert } from './tls'

// The runtime object the routes read via c.env (typed as the global Env in env.d.ts). Built once
// at startup and handed to the Hono app at the single app.fetch() seam in main/server.ts.
export type RuntimeBindings = {
  DB: AppDatabase
  // This Node's durable identity, minted into node.json on first start (main/dataRoot.ts). Every
  // resource a client caches is keyed (nodeId, id), so two nodes holding the same UUID never
  // collide (docs/vNext/architecture.md § Fleet semantics).
  NODE_ID: string
  // The sha256 of this node's TLS certificate — the value a client pins (docs/vNext/protocol.md
  // § Transport and identity), advertised at GET /v2/node.
  //
  // The fingerprint, NOT the certificate and emphatically not the private key: c.env reaches every
  // core and plugin route, so anything placed here is readable by all of them. The key material stays
  // inside main/tls.ts and main/server.ts, which are the only modules that need it.
  NODE_FINGERPRINT: string
  // The app version this node is running, reported at GET /v2/node to an authenticated caller
  // (docs/vNext/protocol.md § Versioning). Injected rather than read from a package.json, because the
  // service is a bundled artifact by then and only the composition root knows the real version.
  APP_VERSION: string
  BLOBS: BlobCache
  // The secret-box key. Named for the session cookie it used to seal; that cookie is gone, but the key
  // outlived it — integration credentials and HTTP-client fields are encrypted at rest with it
  // (server/secretBox.ts), so it is now simply "the key this node encrypts secrets with".
  // ponytail: docs/vNext/data.md wants it renamed `secrets.key`. That is main/sessionKeyStore.ts, the
  // docs, and every developer's .env, for zero behavioural gain — deferred deliberately.
  //
  // Read by exactly two things now: SECRETS below, and the legacy HTTP-storage migration in
  // apps/node/src/wiring/startupSecurity.ts. No plugin touches it — a plugin uses SECRETS, which is
  // the difference between holding the key and being able to use one credential for one purpose
  // (docs/vNext/security.md § Secrets, "No getSecret() free-for-all").
  SESSION_ENC_KEY: string
  // Use-scoped credential access (main/core/secrets.ts). On c.env deliberately: it is strictly less
  // dangerous than the raw SESSION_ENC_KEY that was already here, and it is the seam that scrubs a
  // credential out of a provider error before it reaches a log or a client.
  SECRETS: SecretService
  GITHUB_CLIENT_ID: string
  // Retained deliberately, and nothing reads it. The device authorization grant exchanges on client_id
  // alone (plugins/github/server/routes/deviceAuth.ts), so the last reader left with routes/auth.ts. It
  // stays at the owner's explicit request pending their decision, which is why it is now read
  // OPTIONALLY — a fresh checkout needs no value for it — rather than removed.
  GITHUB_CLIENT_SECRET: string
  // Bearer for loopback callers that hold no device token — the acorn MCP server and other spawned
  // children (docs/mcp.md). Injected into task session env (ACORN_API_TOKEN) so agent-spawned servers
  // inherit it; auth middleware maps it to the machine's single owner. Persisted across boots, because
  // a tmux-reattached agent keeps the environment of the boot that spawned it.
  INTERNAL_TOKEN: string
  // The machine's bound owner identity. Set when a provider account is connected (the github plugin's
  // device flow), and read by every principal — a device inherits it, and a machine caller fails closed
  // without it rather than selecting an arbitrary cached prefs/repo row.
  ACTIVE_IDENTITY: ActiveIdentityStore
  // vNext auth root (docs/vNext/protocol.md § Pairing): paired devices and their revocable bearer
  // tokens, the replay store behind Idempotency-Key, and the one-time pairing window.
  DEVICES: DeviceService
  IDEMPOTENCY: IdempotencyStore
  PAIRING_CODES: PairingCodes
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

// drizzle-generated migrations: packaged as extraResources (<resources>/migrations) in a built
// app, else resolved by walking ancestors from this module. Never from process.cwd().
// ponytail: search ancestors instead of a fixed `../../` — the module sits at a different depth in
// the built bundle (apps/desktop/out/main, where the build copies migrations to out/migrations)
// than in dev/test source (packages/node-core/src/main, next to packages/node-core/migrations), so
// no single relative path serves both.
//
// resourcesPath is an Electron addition to `process`, and node-core compiles against plain Node
// types by design — read it defensively rather than widening the package's type surface.
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

export type BindingsOptions = { dbPath: string; blobsDir: string; nodeId: string; appVersion: string }

// Build the bindings object once at startup. Electron resolves the data root in electron.ts
// (app.getPath('userData') when packaged, the repo-local apps/node/.acorn in dev) and passes
// the paths in; the standalone entry takes ACORN_DATA_DIR or that same dev root.
export function makeBindings({ dbPath, blobsDir, nodeId, appVersion }: BindingsOptions): RuntimeBindings {
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
    NODE_ID: nodeId,
    // ensureCert is idempotent, so calling it here AND in startListener is not two certificates — it is
    // the same one read twice, which is what lets the routes hold the public fingerprint without the
    // bindings ever touching the private key.
    NODE_FINGERPRINT: ensureCert(dataDir).fingerprint,
    APP_VERSION: appVersion,
    BLOBS: diskBlobCache(blobCachePath),
    SESSION_ENC_KEY: encKey,
    SECRETS: new SecretService(encKey),
    GITHUB_CLIENT_ID: secret('GITHUB_CLIENT_ID'),
    // `optional`, not `secret`: nothing reads this any more (see the type above), so demanding it would
    // make a fresh checkout fail to boot over a value with no consumer.
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? '',
    INTERNAL_TOKEN: loadOrCreateInternalToken(dataDir),
    ACTIVE_IDENTITY: activeIdentityStore(dataDir),
    DEVICES: deviceService(db),
    IDEMPOTENCY: idempotencyStore(db),
    PAIRING_CODES: pairingCodes(),
  }
}
