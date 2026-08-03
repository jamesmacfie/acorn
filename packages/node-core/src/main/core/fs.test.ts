import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { confineExistingFile, resolveInRoot } from './fs'

// A worktree holds arbitrary checked-out content. The interesting adversary is not a `../` in a
// request — it is a symlink an untrusted branch committed, which a lexical check cannot see.
const base = mkdtempSync(join(tmpdir(), 'acorn-fs-'))
const root = join(base, 'worktree')
const outside = join(base, 'outside')

beforeAll(() => {
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, 'src', 'app.ts'), 'ok')
  writeFileSync(join(outside, 'secret.txt'), 'id_rsa')
  // The two shapes that matter: a symlinked FILE and a symlinked DIRECTORY pointing out of the root.
  symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'))
  symlinkSync(outside, join(root, 'escape'))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('resolveInRoot', () => {
  it('accepts a path inside the root, and the root itself', () => {
    expect(resolveInRoot(root, 'src/app.ts')).toBe(join(root, 'src', 'app.ts'))
    expect(resolveInRoot(root, '')).toBe(root)
  })

  it('accepts a path that does not exist yet, so a new-file write works', () => {
    expect(resolveInRoot(root, 'src/brand-new.ts')).toBe(join(root, 'src', 'brand-new.ts'))
  })

  it('rejects lexical traversal and absolute paths', () => {
    expect(resolveInRoot(root, '../outside/secret.txt')).toBeNull()
    expect(resolveInRoot(root, 'src/../../outside/secret.txt')).toBeNull()
    expect(resolveInRoot(root, outside)).toBeNull()
  })

  it('rejects a path THROUGH a symlinked directory that leaves the root', () => {
    // Lexically this is `<root>/escape/secret.txt` — inside the root. Only the symlink gate catches it.
    expect(resolveInRoot(root, 'escape/secret.txt')).toBeNull()
    expect(resolveInRoot(root, 'escape/not-created-yet.txt')).toBeNull()
  })
})

describe('confineExistingFile', () => {
  it('resolves a real file to its realpath', async () => {
    await expect(confineExistingFile(root, 'src/app.ts')).resolves.toEqual({ ok: true, path: join(root, 'src', 'app.ts') })
  })

  it('rejects a symlinked LEAF pointing outside the root', async () => {
    // resolveInRoot already covers this: the leaf EXISTS, so its ancestor walk stops at the leaf
    // itself and realpath resolves the symlink. Asserted on both entry points because the taxonomy
    // reports 'escapes' rather than 'missing', and confusing the two would tell the caller (and the
    // owner) the wrong thing about a hostile symlink.
    expect(resolveInRoot(root, 'leak.txt')).toBeNull()
    await expect(confineExistingFile(root, 'leak.txt')).resolves.toEqual({ ok: false, reason: 'escapes' })
  })

  it('classifies absolute, missing, escaping and not-a-file distinctly', async () => {
    await expect(confineExistingFile(root, '/etc/passwd')).resolves.toEqual({ ok: false, reason: 'absolute' })
    await expect(confineExistingFile(root, 'src/nope.ts')).resolves.toEqual({ ok: false, reason: 'missing' })
    await expect(confineExistingFile(root, '../outside/secret.txt')).resolves.toEqual({ ok: false, reason: 'escapes' })
    await expect(confineExistingFile(root, 'src')).resolves.toEqual({ ok: false, reason: 'not-file' })
  })
})
