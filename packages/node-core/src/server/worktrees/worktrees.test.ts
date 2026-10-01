import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyWorktreeFiles, ensureWorktree } from './worktrees'

// Real git subprocesses per test and hook: the defaults (5s test, 10s hook) are too tight under a fully
// parallel run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString()

// A checkout with a stale `origin/main`, written directly as a remote-tracking ref with no network,
// whose HEAD is a different commit, so the source of a newly created branch is distinguishable.
describe('worktree branch source (docs/workspaces-and-tasks.md)', () => {
  let dir: string
  let checkout: string
  let root: string
  let originMainSha: string
  let localMainSha: string
  let checkoutHeadSha: string

  // Built once, then copied per test. These assertions genuinely need real git, since they compare
  // `git rev-parse HEAD` against specific SHAs to prove a task branch inherits the project checkout's
  // HEAD rather than a stale remote-tracking ref. Reusing the fixture avoids rebuilding it per test.
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
    originMainSha = git(src, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(src, 'a.txt'), '2')
    git(src, 'add', '.')
    git(src, 'commit', '-q', '-m', 'two')
    localMainSha = git(src, 'rev-parse', 'HEAD').trim()
    // Leave origin/main at commit one and local main at commit two. The project folder has a topic
    // branch checked out at commit three, so the task has three distinguishable sources.
    git(src, 'update-ref', 'refs/remotes/origin/main', originMainSha)
    git(src, 'switch', '-q', '-c', 'local-topic')
    writeFileSync(join(src, 'a.txt'), '3')
    git(src, 'add', '.')
    git(src, 'commit', '-q', '-m', 'three')
    checkoutHeadSha = git(src, 'rev-parse', 'HEAD').trim()
    // A local 'origin' serving refs/pull/7/head at commit one, so the PR path runs without a network.
    const origin = join(template, 'origin')
    execFileSync('git', ['clone', '-q', '--bare', src, origin])
    git(origin, 'update-ref', 'refs/pull/7/head', originMainSha)
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

  it("creates a new task branch from the project checkout's HEAD, not origin/main", async () => {
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'eng-42-fix-login', null)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(checkoutHeadSha)
      expect(git(res.path, 'rev-parse', 'HEAD').trim()).not.toBe(localMainSha)
      expect(git(res.path, 'rev-parse', 'HEAD').trim()).not.toBe(originMainSha)
      expect(git(res.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('eng-42-fix-login')
    }
  })

  // The PR branch used to be created from FETCH_HEAD, a file in the repo's common dir that every
  // concurrent fetch rewrites, so the branch could be born at another PR's head: right name, clean
  // status, no diff, another task's tree. Asserting the private per-PR ref keeps it out.
  it('creates a PR branch from a private per-PR ref, not FETCH_HEAD', async () => {
    // A decoy FETCH_HEAD: whatever it says must not reach the new branch.
    writeFileSync(join(checkout, '.git', 'FETCH_HEAD'), `${localMainSha}\t\t'refs/pull/999/head' of nowhere\n`)

    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/pr-7', 7)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(originMainSha)
    expect(git(res.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feat/pr-7')
    expect(git(checkout, 'rev-parse', 'refs/acorn/pull/7').trim()).toBe(originMainSha)
  })

  it('reuses an existing branch untouched', async () => {
    git(checkout, 'branch', 'feat/existing', originMainSha)
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/existing', null)
    expect(res.ok).toBe(true)
    if (res.ok) expect(git(res.path, 'rev-parse', 'HEAD').trim()).toBe(originMainSha)
  })

  it.each([null, 7])('identifies a branch occupied by another worktree (pull %s)', async (pullNumber) => {
    const occupied = join(dir, 'outside worktrees\noccupied')
    git(checkout, 'worktree', 'add', '-b', 'feat/occupied', occupied)
    writeFileSync(join(occupied, 'a.txt'), 'uncommitted work')
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'feat/occupied', pullNumber)
    expect(res).toEqual({
      ok: false,
      reason: expect.stringContaining(`Branch 'feat/occupied' is already checked out at '${realpathSync(occupied)}'.`),
    })
    if (res.ok) return
    expect(res.reason).toContain('Release the branch in that worktree, then reopen this task.')
    expect(readFileSync(join(occupied, 'a.txt'), 'utf8')).toBe('uncommitted work')
    expect(git(occupied, 'branch', '--show-current').trim()).toBe('feat/occupied')
    expect(existsSync(join(root, 'acme-widget-feat-occupied'))).toBe(false)
  })

  it('identifies a branch occupied by the project checkout', async () => {
    const res = await ensureWorktree(root, checkout, 'acme', 'widget', 'local-topic', null)
    expect(res).toEqual({ ok: false, reason: expect.stringContaining(`already checked out at '${realpathSync(checkout)}'`) })
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

    it('refuses outside sources, outside destination directories, and dangling destinations', () => {
      const destination = join(dir, 'destination')
      const outside = join(dir, 'synthetic-outside')
      mkdirSync(destination)
      mkdirSync(outside)
      writeFileSync(join(outside, 'sentinel.txt'), 'unchanged')
      symlinkSync(join(outside, 'sentinel.txt'), join(checkout, 'external.txt'))
      mkdirSync(join(checkout, 'redirect'))
      writeFileSync(join(checkout, 'redirect', 'sentinel.txt'), 'copy candidate')
      symlinkSync(outside, join(destination, 'redirect'))
      writeFileSync(join(checkout, 'dangling.txt'), 'copy candidate')
      symlinkSync(join(outside, 'never-created.txt'), join(destination, 'dangling.txt'))
      const result = copyWorktreeFiles(checkout, destination, ['external.txt', 'redirect/sentinel.txt', 'dangling.txt'])
      expect(result.copied).toEqual([])
      expect(result.warnings).toHaveLength(3)
      expect(result.warnings.every((warning) => warning.includes('rejected'))).toBe(true)
      expect(readFileSync(join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
      expect(existsSync(join(outside, 'never-created.txt'))).toBe(false)
      expect(lstatSync(join(destination, 'dangling.txt')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(destination, 'external.txt'))).toBe(false)
    })

    it('copies regular files through safe aliases and never overwrites existing links', () => {
      const destination = join(dir, 'destination')
      mkdirSync(join(destination, 'actual'), { recursive: true })
      mkdirSync(join(checkout, 'actual'))
      writeFileSync(join(checkout, 'actual', 'new.txt'), 'ordinary copy')
      symlinkSync(join(checkout, 'actual'), join(checkout, 'alias'))
      symlinkSync(join(destination, 'actual'), join(destination, 'alias'))
      writeFileSync(join(checkout, 'existing.txt'), 'replacement')
      writeFileSync(join(destination, 'actual', 'existing.txt'), 'unchanged')
      symlinkSync(join(destination, 'actual', 'existing.txt'), join(destination, 'existing.txt'))
      const result = copyWorktreeFiles(checkout, destination, ['alias/new.txt', 'existing.txt', 'actual'])
      expect(result.copied).toEqual(['alias/new.txt'])
      expect(result.warnings).toEqual(["copy: 'actual' is not a regular file, skipped"])
      expect(readFileSync(join(destination, 'actual', 'new.txt'), 'utf8')).toBe('ordinary copy')
      expect(readFileSync(join(destination, 'actual', 'existing.txt'), 'utf8')).toBe('unchanged')
      expect(lstatSync(join(destination, 'existing.txt')).isSymbolicLink()).toBe(true)
    })
  })
})
