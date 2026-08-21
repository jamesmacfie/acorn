import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../testkit/db'
import { schema } from '../server/db'
import { archiveTask, runTeardownProcess, type ArchiveDeps } from './archive'

// Real git subprocesses plus a teardown script per test: the 5s default is too tight under a fully
// parallel run. Matches the other git-backed suites (plugins/changes/main/localGitService.test.ts).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

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

  let template: string

  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), 'acorn-archive-template-'))
    const src = join(template, 'checkout')
    execFileSync('git', ['init', '-q', '-b', 'main', src])
    git(src, 'config', 'user.email', 't@t.test')
    git(src, 'config', 'user.name', 'T')
    writeFileSync(join(src, 'a.txt'), 'a')
    git(src, 'add', '.')
    git(src, 'commit', '-q', '-m', 'init')
  })

  afterAll(() => rmSync(template, { recursive: true, force: true }))

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-archive-'))
    checkout = join(dir, 'checkout')
    // Base repo copied from a template built once (see beforeAll), five fewer git spawns per
    // test. The worktree itself is still created for real below: `worktree add` records absolute
    // paths in .git/worktrees, so it cannot be part of a copied fixture, and these tests are
    // precisely about real worktree teardown and removal.
    cpSync(join(template, 'checkout'), checkout, { recursive: true })
    worktree = join(dir, 'wt')
    git(checkout, 'worktree', 'add', '-q', '-b', 'feat/x', worktree)
    realWorktree = realpathSync(worktree)
    t = makeTestDb()
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'ws1', name: 'W', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: checkout, workspaceId: 'ws1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values({
      id: 'task1',
      title: 'Fix it',
      origin: 'local',
      projectId: 'project-widget',
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

  const setTeardown = (script: string | null) => t.db.update(schema.projects).set({ teardownScript: script })

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

  it('runs the opted-in plugin cleanups while the worktree still exists', async () => {
    const seen: { ids: readonly string[]; worktreeThere: boolean }[] = []
    const res = await archiveTask(t.db, 'task1', { applyChecks: ['docker:containers:c'] }, {
      ...deps(),
      applyTaskChecks: async (task, ids) => {
        seen.push({ ids, worktreeThere: existsSync(task.worktreePath!) })
        return []
      },
    })
    expect(res).toEqual({ ok: true })
    // The whole point of the position: docker's `compose down` and anything else that wants the tree
    // runs before removal, not racing it from the client.
    expect(seen).toEqual([{ ids: ['docker:containers:c'], worktreeThere: true }])
    expect(existsSync(worktree)).toBe(false)
  })

  it('does not ask when nothing was ticked', async () => {
    const applyTaskChecks = vi.fn(async () => [])
    await archiveTask(t.db, 'task1', {}, { ...deps(), applyTaskChecks })
    expect(applyTaskChecks).not.toHaveBeenCalled()
  })

  it('archives anyway when a cleanup fails, and names the plugin', async () => {
    const res = await archiveTask(t.db, 'task1', { applyChecks: ['docker:containers:c'] }, {
      ...deps(),
      applyTaskChecks: async () => ['docker'],
    })
    // `ok` is true because the task is archived; offering a retry for something already done
    // would be worse than saying what did not happen.
    expect(res).toEqual({ ok: true, cleanupFailed: ['docker'] })
    const [row] = await t.db.select().from(schema.tasks)
    expect(row.status).toBe('archived')
  })

  it('never removes the project folder for a legacy checkout-marker task', async () => {
    await t.db.insert(schema.tasks).values({
      id: 'marker-task', title: 'Legacy checkout', origin: 'local', projectId: 'project-widget',
      branch: 'HEAD', worktreePath: checkout,
      status: 'active', sort: 1, createdAt: Date.now(), updatedAt: Date.now(), archivedAt: null,
    })
    const res = await archiveTask(t.db, 'marker-task', { force: true }, deps())
    expect(res).toEqual({ ok: true })
    expect(isDir(checkout)).toBe(true)
  })

  it('current-checkout task (worktreePath === checkout) archives without removing the checkout', async () => {
    // Point the task at the main checkout itself, and dirty it; a real worktree would be refused.
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
