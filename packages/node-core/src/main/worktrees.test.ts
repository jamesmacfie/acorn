import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyWorktreeFiles, ensureWorktree, resolveBaseRef } from './worktrees'

// Real git subprocesses per test and hook: the defaults (5s test, 10s hook) are too tight under a fully
// parallel run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString()

// A checkout with a fake `origin/main` and `origin/develop`, written directly as remote-tracking refs
// with no network, whose HEAD is a different commit, so "created from base ref" is distinguishable.
describe('worktree base-ref precedence (docs/terminal-and-agents.md)', () => {
  let dir: string
  let checkout: string
  let root: string
  let mainSha: string
  let developSha: string

  // Built once, then copied per test. These assertions genuinely need real git, since they compare
  // `git rev-parse HEAD` against specific SHAs to prove we branch off origin/main rather than HEAD. What
  // they don't need is rebuilding the fixture six times over, which was ~78 subprocesses per file and
  // the main reason this suite tipped over its timeouts under a parallel run.
  let template: string

  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), 'acorn-wt-template-'))
    const src = join(template, 'checkout')
    execFileSync('git', ['init', '-q', '-b', 'main', src])
    git(src, 'config', 'user.email', 't@t.test')
    git(src, 'config', 'user.name', 'T')
    writeFileSync(join(src, 'a.txt'), '1')
    git(src, 'add', '.')
    git(src, 'commit', '-q', '-m', 'one')
    mainSha = git(src, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(src, 'a.txt'), '2')
    git(src, 'add', '.')
    git(src, 'commit', '-q', '-m', 'two')
    developSha = git(src, 'rev-parse', 'HEAD').trim()
    // Fake remote-tracking refs: origin/main at commit one, origin/develop at commit two, then advance
    // local HEAD so it's neither.
    git(src, 'update-ref', 'refs/remotes/origin/main', mainSha)
    git(src, 'update-ref', 'refs/remotes/origin/develop', developSha)
    writeFileSync(join(src, 'a.txt'), '3')
    git(src, 'add', '.')
    git(src, 'commit', '-q', '-m', 'three')
    // A local 'origin' serving refs/pull/7/head at commit one, so the PR path runs without a network.
    const origin = join(template, 'origin')
    execFileSync('git', ['clone', '-q', '--bare', src, origin])
    git(origin, 'update-ref', 'refs/pull/7/head', mainSha)
    git(src, 'remote', 'add', 'origin', origin)
  })

  afterAll(() => rmSync(template, { recursive: true, force: true }))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-wt-'))
    checkout = join(dir, 'checkout')
    root = join(dir, 'worktrees')
    cpSync(join(template, 'checkout'), checkout, { recursive: true })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // Several sequential git spawns, over vitest's 5s default when the whole suite runs in parallel.
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

  // The PR branch used to be created from FETCH_HEAD, a file in the repo's common dir that every
  // concurrent fetch rewrites, so the branch could be born at another PR's head: right name, clean
  // status, no diff, another task's tree. Asserting the private per-PR ref keeps it out.
  it('creates a PR branch from a private per-PR ref, not FETCH_HEAD', async () => {
    // A decoy FETCH_HEAD: whatever it says must not reach the new branch.
    writeFileSync(join(checkout, '.git', 'FETCH_HEAD'), `${developSha}\t\t'refs/pull/999/head' of nowhere\n`)

    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/pr-7', 7)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(mainSha)
    expect(git(res.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feat/pr-7')
    expect(git(checkout, 'rev-parse', 'refs/acorn/pull/7').trim()).toBe(mainSha)
  })

  it('reuses an existing branch untouched (no base-ref rewrite)', async () => {
    git(checkout, 'branch', 'feat/existing', mainSha)
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/existing', null, 'origin/develop')
    expect(res.ok).toBe(true)
    if (res.ok) expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(mainSha)
  })

  describe('copyWorktreeFiles (docs/workflows.md §2 copy)', () => {
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
