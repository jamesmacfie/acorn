import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../server/routes/testDb'
import { schema } from '../server/db'
import { archiveTask, runTeardownProcess, type ArchiveDeps } from './archive'

// Real temp git repo + worktree per test (plan §validation: never test against the acorn repo).
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

describe('archiveTask teardown ordering', () => {
  let dir: string
  let checkout: string
  let worktree: string
  let realWorktree: string
  let t: TestDb

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-archive-'))
    checkout = join(dir, 'checkout')
    execFileSync('git', ['init', '-q', '-b', 'main', checkout])
    git(checkout, 'config', 'user.email', 't@t.test')
    git(checkout, 'config', 'user.name', 'T')
    writeFileSync(join(checkout, 'a.txt'), 'a')
    git(checkout, 'add', '.')
    git(checkout, 'commit', '-q', '-m', 'init')
    worktree = join(dir, 'wt')
    git(checkout, 'worktree', 'add', '-q', '-b', 'feat/x', worktree)
    realWorktree = realpathSync(worktree)
    t = makeTestDb()
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'ws1', name: 'W', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.workspaceRepos).values({ workspaceId: 'ws1', repoOwner: 'acme', repoName: 'widget', sort: 0, createdAt: now })
    await t.db.insert(schema.repoPaths).values({ owner: 'acme', repo: 'widget', path: checkout, createdAt: now, updatedAt: now })
    await t.db.insert(schema.tasks).values({
      id: 'task1',
      title: 'Fix it',
      origin: 'local',
      repoOwner: 'acme',
      repoName: 'widget',
      branch: 'feat/x',
      worktreePath: worktree,
      pullNumber: null,
      status: 'active',
      sort: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const deps = (): ArchiveDeps => ({
    isDir,
    runningCount: () => 0,
    killRunning: () => {},
    dropTaskSessions: async () => {},
    runTeardown: runTeardownProcess,
  })

  const setTeardown = (script: string | null) => t.db.update(schema.workspaces).set({ teardownScript: script })

  it('runs teardown in the live worktree (ACORN_* env) before removal', async () => {
    const marker = join(dir, 'marker')
    await setTeardown(`echo "$PWD|$ACORN_TASK_ID|$ACORN_TASK_SLUG|$ACORN_BRANCH" > ${marker}`)
    const res = await archiveTask(t.db, 'task1', {}, deps())
    expect(res).toEqual({ ok: true })
    // Marker written from inside the worktree with the identity env → teardown ran while it existed.
    // (realpath: macOS tmpdir is a /private symlink, so $PWD reports the resolved path.)
    expect(readFileSync(marker, 'utf8').trim()).toBe(`${realWorktree}|task1|feat-x|feat/x`)
    expect(existsSync(worktree)).toBe(false)
    const [row] = await t.db.select().from(schema.tasks)
    expect(row.status).toBe('archived')
    expect(row.worktreePath).toBeNull()
  })

  it('non-zero teardown pauses the archive and removes nothing', async () => {
    await setTeardown('echo boom >&2; exit 3')
    const res = await archiveTask(t.db, 'task1', {}, deps())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.teardownFailed).toBe(true)
      expect(res.output).toContain('boom')
    }
    expect(existsSync(worktree)).toBe(true)
    const [row] = await t.db.select().from(schema.tasks)
    expect(row.status).toBe('active')
  })

  it('skipTeardown archives past a failing script', async () => {
    await setTeardown('exit 1')
    const res = await archiveTask(t.db, 'task1', { skipTeardown: true }, deps())
    expect(res).toEqual({ ok: true })
    expect(existsSync(worktree)).toBe(false)
  })

  it('no teardown configured → unchanged behaviour', async () => {
    const res = await archiveTask(t.db, 'task1', {}, deps())
    expect(res).toEqual({ ok: true })
    expect(existsSync(worktree)).toBe(false)
  })

  it('still refuses a dirty worktree without force (guard unchanged)', async () => {
    writeFileSync(join(worktree, 'dirty.txt'), 'x')
    const res = await archiveTask(t.db, 'task1', {}, deps())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('uncommitted')
    expect(existsSync(worktree)).toBe(true)
  })

  it('refuses while sessions run unless forced', async () => {
    const d = { ...deps(), runningCount: () => 2 }
    const res = await archiveTask(t.db, 'task1', {}, d)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('running session')
  })

  it('current-checkout task (worktreePath === checkout) archives without removing the checkout', async () => {
    // Point the task at the main checkout itself, and dirty it — a real worktree would be refused.
    await t.db.update(schema.tasks).set({ worktreePath: checkout }).where(eq(schema.tasks.id, 'task1'))
    writeFileSync(join(checkout, 'scratch.txt'), 'wip')
    const res = await archiveTask(t.db, 'task1', {}, deps())
    expect(res).toEqual({ ok: true })
    expect(existsSync(checkout)).toBe(true) // never git-removed
    expect(existsSync(join(checkout, 'scratch.txt'))).toBe(true) // dirty files untouched
    const [row] = await t.db.select().from(schema.tasks)
    expect(row.status).toBe('archived')
    expect(row.worktreePath).toBeNull()
  })
})
