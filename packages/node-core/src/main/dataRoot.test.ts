import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import { openDataRoot, type DataRoot } from './dataRoot'

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
      // already released by the test
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
    expect(identity.protocolVersion).toBe(NODE_PROTOCOL_VERSION)
    expect(identity.createdAt).toBeGreaterThan(0)
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

  // The reason the lock stores a pid rather than merely existing: a crashed node leaves the file
  // behind, and without a liveness probe the next start would be wedged until someone rm'd it.
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
