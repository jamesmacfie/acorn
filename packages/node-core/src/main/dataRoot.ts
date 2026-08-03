import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { NODE_PROTOCOL_VERSION, nodeIdentitySchema, type NodeIdentity } from '@acorn/protocol/node.ts'

// The vNext data root (docs/vNext/data.md). Opening one is what makes a directory a Node: it mints
// or reads the nodeId, takes an exclusive lock, and refuses a V1 root outright.
//
// vNext never migrates V1 databases (docs/vNext/plan.md § Approach) — first launch starts fresh and
// the config-only importer arrives in Phase 5. So a directory holding V1's acorn.sqlite is a hard
// error rather than something we silently open beside.

const IDENTITY_FILE = 'node.json'
const LOCK_FILE = 'node.lock'
const V1_DATABASE = 'acorn.sqlite'
const LOGS_DIR = 'logs'

export type DataRoot = {
  dir: string
  nodeId: string
  // Last bound listener port, if this root has ever bound one. Callers prefer it and fall back to
  // an ephemeral port when it is taken.
  preferredPort: number | undefined
  recordPort(port: number): void
  release(): void
}

// Atomic 0600 write: tmp + fsync + rename, so a crash mid-write cannot leave a truncated identity
// file (the same shape activeIdentity.ts uses for the same reason).
function writePrivateAtomic(path: string, body: string): void {
  const temporary = `${path}.${process.pid}.tmp`
  const fd = openSync(temporary, 'w', 0o600)
  try {
    writeSync(fd, body)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

// Is `pid` a live process we must yield to?
//
// ponytail: PID reuse is the ceiling. After a reboot the recorded pid can belong to an unrelated
// live process and we refuse a legitimate start — which fails CLOSED, the safe direction, and the
// caller's error names the lock file to delete. Node exposes no flock(2), and the alternatives are
// worse: a mkdir lock has the same staleness problem with no pid to probe, a unix socket hits
// macOS's ~104-byte sun_path limit on mkdtemp paths in tests, and SQLite's locking_mode=EXCLUSIVE
// guards only the database while locking out db:migrate/db:locate for the whole run.
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH: no such process — the holder died without releasing. EPERM: it exists but belongs to
    // another user, so it is live as far as we are concerned.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function acquireLock(dir: string): () => void {
  const path = join(dir, LOCK_FILE)
  const claim = (): number | null => {
    try {
      const fd = openSync(path, 'wx', 0o600)
      try {
        writeSync(fd, `${process.pid}\n`)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const raw = (() => {
        try {
          return readFileSync(path, 'utf8').trim()
        } catch {
          return '' // vanished between open and read — treat as stale and retry
        }
      })()
      const pid = Number.parseInt(raw, 10)
      // An unparseable lock file cannot be attributed to a live process, so it is stale by
      // definition. Reporting NaN here would be a permanent wedge with no way out but manual rm.
      return Number.isInteger(pid) && pid > 0 ? pid : 0
    }
  }

  const holder = claim()
  if (holder !== null) {
    if (holder !== 0 && processIsAlive(holder)) {
      throw new Error(
        `Another acorn node already holds ${dir} (pid ${holder}). Stop it first, or delete ${path} if that process is gone.`,
      )
    }
    // Stale: the previous holder crashed. Take it over — once. A second EEXIST here means a real
    // race with another starting node, and losing it is correct.
    rmSync(path, { force: true })
    const contender = claim()
    if (contender !== null) {
      throw new Error(`Another acorn node is starting in ${dir} (pid ${contender || 'unknown'}).`)
    }
  }

  let released = false
  const release = () => {
    if (released) return
    released = true
    process.off('exit', release)
    try {
      // Only remove a lock we still own; a stale-takeover by someone else must not be clobbered.
      if (readFileSync(path, 'utf8').trim() === String(process.pid)) rmSync(path, { force: true })
    } catch {
      // Already gone, or unreadable — nothing useful to do while tearing down.
    }
  }
  process.on('exit', release)
  return release
}

function readIdentity(path: string): NodeIdentity | null {
  try {
    const parsed = nodeIdentitySchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// Open (or initialise) the data root at `dir`. Throws if a V1 root, if another node holds it, or if
// the identity file is unreadable — never falls back to a fresh identity for an existing root,
// because that would silently orphan the node's paired devices.
export function openDataRoot(dir: string): DataRoot {
  if (existsSync(join(dir, V1_DATABASE))) {
    throw new Error(
      `${dir} holds a V1 acorn database (${V1_DATABASE}). vNext never migrates V1 data — point it at a fresh data root; V1's files stay untouched.`,
    )
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700) // migrate a root created under a permissive umask
  mkdirSync(join(dir, LOGS_DIR), { recursive: true, mode: 0o700 })

  const release = acquireLock(dir)
  try {
    const identityPath = join(dir, IDENTITY_FILE)
    const existed = existsSync(identityPath)
    const existing = existed ? readIdentity(identityPath) : null
    if (existed && !existing) {
      throw new Error(`${identityPath} is unreadable or malformed. Fix or remove it — refusing to mint a second identity for this root.`)
    }
    let identity: NodeIdentity =
      existing ?? { nodeId: randomUUID(), createdAt: Date.now(), protocolVersion: NODE_PROTOCOL_VERSION }
    if (!existing) writePrivateAtomic(identityPath, `${JSON.stringify(identity, null, 2)}\n`)
    else chmodSync(identityPath, 0o600)

    return {
      dir,
      nodeId: identity.nodeId,
      preferredPort: identity.port,
      recordPort(port) {
        if (port === identity.port || !Number.isInteger(port) || port < 1) return
        identity = { ...identity, port }
        writePrivateAtomic(identityPath, `${JSON.stringify(identity, null, 2)}\n`)
      },
      release,
    }
  } catch (error) {
    release() // never hold the lock on a failed open
    throw error
  }
}
