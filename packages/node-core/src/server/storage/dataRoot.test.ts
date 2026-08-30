import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDataRoot, readNodeAttachment, recordEnrollmentFailure, recordNodeAttachment, type DataRoot } from './dataRoot'

const dirs: string[] = []
const open: DataRoot[] = []

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-data-root-'))
  dirs.push(dir)
  return dir
}

function openTracked(dir: string): DataRoot {
  const root = openDataRoot(dir)
  open.push(root)
  return root
}

afterEach(() => {
  for (const root of open.splice(0)) {
    try {
      root.release()
    } catch {
      // Already released by the test.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const mode = (path: string) => statSync(path).mode & 0o777

describe('openDataRoot', () => {
  it('mints a stable identity and reuses it across reopen', () => {
    const dir = freshDir()
    const first = openTracked(dir)
    expect(first.nodeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.preferredPort).toBeUndefined()
    first.release()

    const second = openTracked(dir)
    expect(second.nodeId).toBe(first.nodeId)

    const identity = JSON.parse(readFileSync(join(dir, 'node.json'), 'utf8'))
    expect(identity.createdAt).toBeGreaterThan(0)
    // Deliberately absent. It was written once here and read by nothing, and it went stale the moment the
    // binary serving this root moved on (docs/api-reference.md § Versioning). The live answer is the
    // running binary's NODE_PROTOCOL_VERSION, reported at GET /v2/node.
    expect(identity).not.toHaveProperty('protocolVersion')
  })

  it('creates the root, logs dir and identity file with private permissions', () => {
    const dir = join(freshDir(), 'nested')
    const root = openTracked(dir)
    expect(mode(dir)).toBe(0o700)
    expect(mode(join(dir, 'logs'))).toBe(0o700)
    expect(mode(join(dir, 'node.json'))).toBe(0o600)
    expect(mode(join(dir, 'node.lock'))).toBe(0o600)
    root.release()
  })

  it('refuses a second holder while the first is live', () => {
    const dir = freshDir()
    openTracked(dir)
    expect(() => openDataRoot(dir)).toThrow(/already holds/)
  })

  it('releases the lock so the root can be reopened', () => {
    const dir = freshDir()
    const first = openTracked(dir)
    first.release()
    expect(existsSync(join(dir, 'node.lock'))).toBe(false)
    expect(() => openTracked(dir)).not.toThrow()
  })

  // The reason the lock stores a pid rather than merely existing: a crashed node leaves the file behind,
  // and without a liveness probe the next start would be wedged until someone removed it.
  it('takes over a lock whose holder is gone', () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'node.lock'), '999999999\n', { mode: 0o600 })
    const root = openTracked(dir)
    expect(readFileSync(join(dir, 'node.lock'), 'utf8').trim()).toBe(String(process.pid))
    root.release()
  })

  it('takes over an unparseable lock rather than wedging forever', () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'node.lock'), 'not-a-pid\n', { mode: 0o600 })
    expect(() => openTracked(dir)).not.toThrow()
  })

  it('does not remove a lock that was taken over by someone else', () => {
    const dir = freshDir()
    const root = openTracked(dir)
    writeFileSync(join(dir, 'node.lock'), '999999999\n', { mode: 0o600 })
    root.release()
    expect(readFileSync(join(dir, 'node.lock'), 'utf8').trim()).toBe('999999999')
  })

  // The current data-root format is explicit. A source database is handled only through the opt-in
  // importer, so opening a root containing the source filename must fail loudly.
  it('refuses a V1 data root', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'acorn.sqlite'), Buffer.alloc(0))
    expect(() => openDataRoot(dir)).toThrow(/V1 acorn database/)
    expect(existsSync(join(dir, 'node.json'))).toBe(false)
  })

  it('refuses a malformed identity instead of minting a second one', () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'node.json'), '{ "nodeId": 42 }')
    expect(() => openDataRoot(dir)).toThrow(/unreadable or malformed/)
  })

  it('leaves no lock behind when the open fails', () => {
    const dir = freshDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'node.json'), 'not json at all')
    expect(() => openDataRoot(dir)).toThrow()
    expect(existsSync(join(dir, 'node.lock'))).toBe(false)
  })

  it('remembers the last bound port across reopen', () => {
    const dir = freshDir()
    const first = openTracked(dir)
    first.recordPort(45123)
    first.release()
    expect(openTracked(dir).preferredPort).toBe(45123)
  })

  it('never persists a port of zero', () => {
    const dir = freshDir()
    const root = openTracked(dir)
    root.recordPort(0)
    root.release()
    expect(openTracked(dir).preferredPort).toBeUndefined()
  })
})

// The attachment record (docs/node-enrollment.md). Written by enrollment at boot, read by a route in
// a later process, and dropped by detach, so the three go through the file rather than a shared object.
describe('the attachment record on node.json', () => {
  it('is absent on a node nobody provisioned, and survives a reopen once written', () => {
    const dir = freshDir()
    const root = openTracked(dir)
    expect(readNodeAttachment(dir).attachment).toBeUndefined()

    recordNodeAttachment(dir, {
      controlPlaneUrl: 'https://control.example/',
      attachedAt: 1_700_000_000_000,
      enrollmentTokenId: 'abc123abc123',
      deviceId: 'device-1',
    })
    expect(readNodeAttachment(dir).attachment?.controlPlaneUrl).toBe('https://control.example/')

    root.release()
    // A second process reads the same node, identity intact: an attachment is one more optional field,
    // not a second identity.
    const reopened = openTracked(dir)
    expect(reopened.nodeId).toBe(root.nodeId)
    expect(readNodeAttachment(dir).attachment?.deviceId).toBe('device-1')
  })

  it('is dropped by detaching, leaving the rest of the identity alone', () => {
    const dir = freshDir()
    const root = openTracked(dir)
    root.recordPort(4444)
    recordNodeAttachment(dir, {
      controlPlaneUrl: 'https://control.example/',
      attachedAt: 1_700_000_000_000,
      enrollmentTokenId: 'abc123abc123',
      deviceId: 'device-1',
    })

    recordNodeAttachment(dir, undefined)
    expect(readNodeAttachment(dir).attachment).toBeUndefined()
    // The whole promise of detaching: nothing else about the node changed.
    expect(JSON.parse(readFileSync(join(dir, 'node.json'), 'utf8'))).toMatchObject({ nodeId: root.nodeId, port: 4444 })
  })

  it('records a failed enrollment, and clears it when one later succeeds', () => {
    const dir = freshDir()
    openTracked(dir)
    recordEnrollmentFailure(dir, 'control.example refused the token')
    expect(readNodeAttachment(dir).enrollmentError?.reason).toContain('refused')

    recordNodeAttachment(dir, {
      controlPlaneUrl: 'https://control.example/',
      attachedAt: 1_700_000_000_000,
      enrollmentTokenId: 'abc123abc123',
      deviceId: 'device-1',
    })
    // A stale failure beside a live attachment would read as a node in trouble when it is fine.
    expect(readNodeAttachment(dir).enrollmentError).toBeUndefined()
  })

  it('does not let an in-process write clobber an attachment recorded after the root opened', () => {
    // The reason recordPort re-reads the file instead of serialising its own cached copy. Two writers
    // own node.json now, and the second one to write used to win everything.
    const dir = freshDir()
    const root = openTracked(dir)
    recordNodeAttachment(dir, {
      controlPlaneUrl: 'https://control.example/',
      attachedAt: 1_700_000_000_000,
      enrollmentTokenId: 'abc123abc123',
      deviceId: 'device-1',
    })
    root.recordPort(5555)
    expect(readNodeAttachment(dir).attachment?.deviceId).toBe('device-1')
    expect(root.preferredPort).toBe(5555)
  })
})
