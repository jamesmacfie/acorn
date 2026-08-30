import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { nodeIdentitySchema, type NodeIdentity } from '@acorn/protocol/node.ts'

const IDENTITY_FILE = 'node.json'
const LOCK_FILE = 'node.lock'
const V1_DATABASE = 'acorn.sqlite'
const LOGS_DIR = 'logs'

export type DataRoot = {
  dir: string
  nodeId: string
  // Last bound listener port, if this root has ever bound one. Callers prefer it and fall back to an
  // ephemeral port when it is taken. It reflects recordPort within this process.
  readonly preferredPort: number | undefined
  recordPort(port: number): void
  // The operator's answer to "which host should this node advertise?", or undefined if nobody has
  // asked. '' means they answered loopback only. That distinction from undefined is what stops the
  // prompt reappearing every boot (server/transport/advertise.ts).
  readonly advertiseHost: string | undefined
  recordAdvertiseHost(host: string): void
  release(): void
}

// Atomic write: temp file, fsync, rename, so a crash mid-write cannot leave a truncated file behind
// (docs/data-layer.md § Data root). Exported because server/sessionKey.ts needs the same posture, where
// a half-written key would make every stored credential unrecoverable.
export function writePrivateAtomic(path: string, body: string): void {
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

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH means no such process, so the holder died without releasing. EPERM means it exists but
    // belongs to another user, so treat it as live.
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
          return '' // vanished between open and read, treat as stale and retry
        }
      })()
      const pid = Number.parseInt(raw, 10)
      // An unparseable lock file names no live process, so it is stale. Reporting NaN here wedges
      // the root permanently, with no way out but a manual rm.
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
    // Stale, so the previous holder crashed. Take it over once. A second EEXIST means a race with
    // another starting node, and losing that race is correct.
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
      // Only remove a lock we still own, so a stale takeover by someone else survives.
      if (readFileSync(path, 'utf8').trim() === String(process.pid)) rmSync(path, { force: true })
    } catch {
      // Already gone or unreadable, and there is nothing useful to do while tearing down.
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

const identityPathOf = (dir: string): string => join(dir, IDENTITY_FILE)

// Read-modify-write against the file, not against a field captured in memory. Two owners write
// node.json now — this process's DataRoot, and the attachment functions below, which a route calls
// long after the root was opened — so a writer that serialised its own cached copy would silently
// drop whatever the other one had recorded.
function updateIdentity(path: string, patch: Partial<NodeIdentity>): NodeIdentity {
  const current = readIdentity(path)
  if (!current) throw new Error(`${path} is unreadable or malformed; refusing to overwrite this node's identity.`)
  const next = { ...current, ...patch }
  // Undefined in a patch means "remove this field", which is what detaching does. JSON.stringify
  // drops it, so the merge above is enough and no delete is needed.
  writePrivateAtomic(path, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/** Who this node is attached to, and why the last enrollment failed. Read straight off disk rather
 *  than from an open DataRoot, because the reader is a route and the writer was a boot-time
 *  enrollment in a process that has since restarted (docs/node-enrollment.md). */
export function readNodeAttachment(dir: string): Pick<NodeIdentity, 'attachment' | 'enrollmentError'> {
  const identity = readIdentity(identityPathOf(dir))
  return {
    ...(identity?.attachment ? { attachment: identity.attachment } : {}),
    ...(identity?.enrollmentError ? { enrollmentError: identity.enrollmentError } : {}),
  }
}

/** Record an attachment, or drop it. Recording clears any previous failure, and dropping clears both:
 *  a detached node is a node with nothing to say about a control plane. */
export function recordNodeAttachment(dir: string, attachment: NodeIdentity['attachment']): void {
  updateIdentity(identityPathOf(dir), { attachment, enrollmentError: undefined })
}

/** Record that enrollment was attempted and failed. Visible at GET /v2/core/attachment, because the
 *  alternative — a provisioned node that boots normally and is attached to nothing — is the failure
 *  nobody notices. */
export function recordEnrollmentFailure(dir: string, reason: string): void {
  updateIdentity(identityPathOf(dir), { enrollmentError: { at: Date.now(), reason } })
}

// Open the data root at `dir`, initialising it if needed (docs/data-layer.md § Data root). Throws
// rather than falling back to a fresh identity when the directory holds a source database, another
// node holds it, or the identity file is unreadable.
export function openDataRoot(dir: string): DataRoot {
  if (existsSync(join(dir, V1_DATABASE))) {
    throw new Error(
      `${dir} holds a V1 acorn database (${V1_DATABASE}). vNext never migrates V1 data, so point it at a fresh data root. V1's files stay untouched.`,
    )
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700) // repair a root created under a permissive umask
  mkdirSync(join(dir, LOGS_DIR), { recursive: true, mode: 0o700 })

  const release = acquireLock(dir)
  try {
    const identityPath = join(dir, IDENTITY_FILE)
    const existed = existsSync(identityPath)
    const existing = existed ? readIdentity(identityPath) : null
    if (existed && !existing) {
      throw new Error(`${identityPath} is unreadable or malformed. Fix or remove it. Minting a second identity for this root would orphan the first.`)
    }
    // No `protocolVersion` field (docs/data-layer.md § Data root, docs/api-reference.md § Versioning).
    let identity: NodeIdentity = existing ?? { nodeId: randomUUID(), createdAt: Date.now() }
    if (!existing) writePrivateAtomic(identityPath, `${JSON.stringify(identity, null, 2)}\n`)
    else chmodSync(identityPath, 0o600)

    return {
      dir,
      nodeId: identity.nodeId,
      // A getter, not a snapshot. recordPort replaces `identity`, so a field captured here keeps
      // reporting whatever was on disk when the root opened. Production opens once per process and
      // never sees it, but anything that rebinds within one process does.
      get preferredPort() {
        return identity.port
      },
      recordPort(port) {
        if (port === identity.port || !Number.isInteger(port) || port < 1) return
        identity = updateIdentity(identityPath, { port })
      },
      get advertiseHost() {
        return identity.advertiseHost
      },
      recordAdvertiseHost(host) {
        // Equality alone, without recordPort's validity checks. Writing '' over a missing field is
        // the change that stops the first-boot prompt, and `'' === undefined` is false, so this
        // guard lets it through.
        if (host === identity.advertiseHost) return
        identity = updateIdentity(identityPath, { advertiseHost: host })
      },
      release,
    }
  } catch (error) {
    release() // never hold the lock after a failed open
    throw error
  }
}
