import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyWorktreeFiles, ensureWorktree, resolveBaseRef } from './worktrees'

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

  // Several sequential git spawns — over vitest's 5s default when the whole suite runs in parallel.
  it('resolveBaseRef: preferred → origin/main → null', { timeout: 15_000 }, async () => {
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

  describe('copyWorktreeFiles (docs/next 13 §A copy)', () => {
    it('copies a gitignored file into the worktree, creating parents', async () => {
      writeFileSync(join(checkout, '.env.local'), 'SECRET=1')
      mkdirSync(join(checkout, 'config'), { recursive: true })
      writeFileSync(join(checkout, 'config', 'dev.json'), '{}')
      const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/copy', null)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      const out = copyWorktreeFiles(checkout, res.path, ['.env.local', 'config/dev.json'])
      expect(out.copied).toEqual(['.env.local', 'config/dev.json'])
      expect(out.warnings).toEqual([])
      expect(readFileSync(join(res.path, '.env.local'), 'utf8')).toBe('SECRET=1')
    })

    it('warns on missing entries, rejects traversal/absolute, never overwrites', async () => {
      writeFileSync(join(checkout, '.env.local'), 'FROM_CHECKOUT')
      const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/copy2', null)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      writeFileSync(join(res.path, '.env.local'), 'ALREADY_HERE')
      const out = copyWorktreeFiles(checkout, res.path, ['.env.local', 'missing.txt', '../evil', '/etc/passwd'])
      expect(out.copied).toEqual([])
      expect(out.warnings).toHaveLength(3)
      expect(out.warnings.join(' ')).toMatch(/missing\.txt.*skipped/)
      expect(out.warnings.join(' ')).toMatch(/\.\.\/evil.*rejected/)
      expect(readFileSync(join(res.path, '.env.local'), 'utf8')).toBe('ALREADY_HERE')
    })
  })
})
