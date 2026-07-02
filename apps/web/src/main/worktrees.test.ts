import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureWorktree, resolveBaseRef } from './worktrees'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString()

// A checkout with a fake `origin/main` + `origin/develop` (remote-tracking refs written directly —
// no network) whose HEAD is a *different* commit, so "created from base ref" is distinguishable.
describe('worktree base-ref precedence (docs/next 02 P2)', () => {
  let dir: string
  let checkout: string
  let root: string
  let mainSha: string
  let developSha: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-wt-'))
    checkout = join(dir, 'checkout')
    root = join(dir, 'worktrees')
    execFileSync('git', ['init', '-q', '-b', 'main', checkout])
    git(checkout, 'config', 'user.email', 't@t.test')
    git(checkout, 'config', 'user.name', 'T')
    writeFileSync(join(checkout, 'a.txt'), '1')
    git(checkout, 'add', '.')
    git(checkout, 'commit', '-q', '-m', 'one')
    mainSha = git(checkout, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(checkout, 'a.txt'), '2')
    git(checkout, 'add', '.')
    git(checkout, 'commit', '-q', '-m', 'two')
    developSha = git(checkout, 'rev-parse', 'HEAD').trim()
    // Fake remote-tracking refs: origin/main at commit one, origin/develop at commit two; then
    // advance local HEAD further so HEAD ≠ either.
    git(checkout, 'update-ref', 'refs/remotes/origin/main', mainSha)
    git(checkout, 'update-ref', 'refs/remotes/origin/develop', developSha)
    writeFileSync(join(checkout, 'a.txt'), '3')
    git(checkout, 'add', '.')
    git(checkout, 'commit', '-q', '-m', 'three')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('resolveBaseRef: preferred → origin/main → null', async () => {
    expect(await resolveBaseRef(checkout, 'origin/develop')).toBe('origin/develop')
    expect(await resolveBaseRef(checkout, 'missing/ref')).toBe('origin/main')
    expect(await resolveBaseRef(checkout, null)).toBe('origin/main')
    git(checkout, 'update-ref', '-d', 'refs/remotes/origin/main')
    git(checkout, 'update-ref', '-d', 'refs/remotes/origin/develop')
    expect(await resolveBaseRef(checkout, null)).toBeNull()
    expect(await resolveBaseRef(checkout, '-evil')).toBeNull()
  })

  it('creates the custom branch off origin/main by default (not HEAD)', async () => {
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'eng-42-fix-login', null)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(mainSha)
      expect(git(res.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('eng-42-fix-login')
    }
  })

  it('honours the per-repo preferred base ref', async () => {
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/x', null, 'origin/develop')
    expect(res.ok).toBe(true)
    if (res.ok) expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(developSha)
  })

  it('reuses an existing branch untouched (no base-ref rewrite)', async () => {
    git(checkout, 'branch', 'feat/existing', mainSha)
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/existing', null, 'origin/develop')
    expect(res.ok).toBe(true)
    if (res.ok) expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(mainSha)
  })
})
