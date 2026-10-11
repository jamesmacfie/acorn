import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import { taskScripts } from '../taskScripts/service'
import { createTaskService } from '../core/tasks'
import { registerCheckoutAdmission, type CheckoutAdmission } from '../core/checkoutAdmission'
import { worktreeBranchDirName } from '../worktrees/pathGuards'
import { archiveTask, restoreTask, runTeardownProcess, type ArchiveDeps } from './archive'
import { computeTaskStatuses, setWorktreesRoot, taskRoot } from '../worktrees/taskWorktree'

// Real git subprocesses plus a teardown script per test: the 5s default is too tight under a fully
// parallel run. Matches the other git-backed suites (plugins/git/main/localGitService.test.ts).
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
    registerCheckoutAdmission(t.db, {
      admitWork: async (_taskId: string, action: () => Promise<unknown>) => action(),
    } as unknown as CheckoutAdmission)
    const now = Date.now()
    await t.db
      .insert(schema.workspaces)
      .values({ id: 'ws1', name: 'W', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-widget',
      name: 'widget',
      path: checkout,
      workspaceId: 'ws1',
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: 'acme',
      githubName: 'widget',
      githubRepoId: null,
      createdAt: now,
      updatedAt: now,
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

  const addSubtasks = async () => {
    const childWorktree = join(dir, 'child-wt')
    git(checkout, 'worktree', 'add', '-q', '-b', 'feat/child', childWorktree)
    const now = Date.now()
    await t.db.insert(schema.tasks).values([
      {
        id: 'child',
        title: 'Child task',
        origin: 'local',
        projectId: 'project-widget',
        parentId: 'task1',
        branch: 'feat/child',
        worktreePath: childWorktree,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'archived-child',
        title: 'Archived intermediate task',
        origin: 'local',
        projectId: 'project-widget',
        parentId: 'child',
        status: 'archived',
        archivedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'grandchild',
        title: 'Nested task',
        origin: 'workflows:child',
        projectId: 'project-widget',
        parentId: 'archived-child',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'unrelated',
        title: 'Another task',
        origin: 'local',
        projectId: 'project-widget',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ])
    return childWorktree
  }

  it('archives every descendant with its own lifecycle and leaves unrelated tasks active', async () => {
    const childWorktree = await addSubtasks()
    await setTeardown('true')
    const stopped: string[] = []
    const dropped: string[] = []
    const teardown: string[] = []
    const cleanups: string[] = []
    const result = await archiveTask(
      t.db,
      'task1',
      { force: true, applyChecks: ['docker:containers:c'] },
      {
        ...deps(),
        runningCount: () => 1,
        killRunning: (id) => {
          stopped.push(id)
        },
        taskArchiving: async (id) => {
          expect(stopped).toContain(id)
        },
        dropTaskSessions: async (id) => {
          dropped.push(id)
        },
        runTeardown: async (script, cwd, env, id) => {
          expect(isDir(cwd)).toBe(true)
          expect(env.ACORN_TASK_ID).toBe(id)
          teardown.push(id)
          return runTeardownProcess(script, cwd, env)
        },
        applyTaskChecks: async (task) => {
          cleanups.push(task.id)
          return []
        },
      },
    )
    expect(result).toEqual({ ok: true, archivedTaskIds: ['grandchild', 'child', 'task1'] })
    expect(stopped).toEqual(['grandchild', 'child', 'task1'])
    expect(dropped).toEqual(stopped)
    expect(teardown).toEqual(['child', 'task1'])
    expect(cleanups).toEqual(['task1'])
    expect(existsSync(worktree)).toBe(false)
    expect(existsSync(childWorktree)).toBe(false)
    const rows = await t.db.select().from(schema.tasks)
    expect(rows.filter((row) => row.status === 'active').map((row) => row.id)).toEqual(['unrelated'])
    for (const row of rows.filter((row) => row.id !== 'unrelated')) {
      expect(row.archivedAt).toEqual(expect.any(Number))
      expect(row.worktreePath).toBeNull()
    }
  })

  it('keeps the parent active on a subtask failure and skips completed subtasks on retry', async () => {
    const childWorktree = await addSubtasks()
    await setTeardown('exit 3')
    const dropped: string[] = []
    const d = {
      ...deps(),
      dropTaskSessions: async (id: string) => {
        dropped.push(id)
      },
    }
    expect(await archiveTask(t.db, 'task1', {}, d)).toMatchObject({
      ok: false,
      teardownFailed: true,
      reason: 'Could not archive subtask "Child task": Teardown script failed (exit 3).',
      archivedTaskIds: ['grandchild'],
    })
    expect(isDir(worktree)).toBe(true)
    expect(isDir(childWorktree)).toBe(true)
    expect((await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task1')))[0]?.status).toBe('active')
    expect(await archiveTask(t.db, 'task1', { skipTeardown: true }, d)).toEqual({
      ok: true,
      archivedTaskIds: ['child', 'task1'],
    })
    expect(dropped).toEqual(['grandchild', 'child', 'task1'])
    expect(isDir(worktree)).toBe(false)
    expect(isDir(childWorktree)).toBe(false)
  })

  it('claims the whole tree and refuses new children while a descendant is being archived', async () => {
    await addSubtasks()
    const result = await archiveTask(
      t.db,
      'task1',
      {},
      {
        ...deps(),
        dropTaskSessions: async (id) => {
          if (id !== 'grandchild') return
          expect(await archiveTask(t.db, 'child', {}, deps())).toEqual({
            ok: false,
            reason: 'Task archive is already in progress.',
          })
          expect(await taskRoot(t.db, 'task1')).toBeNull()
          await expect(
            createTaskService(t.db).createChild('task1', { title: 'Late child', branch: 'late' }),
          ).rejects.toThrow('being archived')
        },
      },
    )
    expect(result.ok).toBe(true)
    expect((await t.db.select().from(schema.tasks)).map((row) => row.title)).not.toContain('Late child')
  })

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
    expect(taskScripts(t.db).status('task1').teardown).toMatchObject({ state: 'succeeded', exitCode: 0 })
  })

  it('stops managed agents after teardown and before worktree removal', async () => {
    const order: string[] = []
    await setTeardown('true')
    const res = await archiveTask(
      t.db,
      'task1',
      {},
      {
        ...deps(),
        runTeardown: async (script, cwd, env) => {
          order.push(`teardown:${existsSync(worktree)}`)
          return runTeardownProcess(script, cwd, env)
        },
        taskArchiving: async (taskId) => {
          order.push(`archiving:${taskId}:${existsSync(worktree)}`)
        },
        dropTaskSessions: async () => {
          order.push(`drop:${existsSync(worktree)}`)
        },
      },
    )
    expect(res).toEqual({ ok: true })
    // The archiving hook runs on every archive, after teardown and while the worktree still exists,
    // because the agents plugin stops processes that are writing into it.
    expect(order).toEqual(['teardown:true', 'archiving:task1:true', 'drop:false'])
  })

  it('does not serve or recreate the worktree while archive owns the task', async () => {
    let rootDuringDrop: string | undefined | null
    const res = await archiveTask(
      t.db,
      'task1',
      {},
      {
        ...deps(),
        dropTaskSessions: async () => {
          rootDuringDrop = await taskRoot(t.db, 'task1')
          await expect(computeTaskStatuses(t.db)).resolves.toEqual([])
        },
      },
    )

    expect(res).toEqual({ ok: true })
    expect(rootDuringDrop).toBeNull()
    expect(existsSync(worktree)).toBe(false)
    // The retained historical row must not make a later pane or plugin call recreate the directory.
    await expect(taskRoot(t.db, 'task1')).resolves.toBeNull()
    expect(existsSync(worktree)).toBe(false)
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
    // A refusal releases the transient gate so the active task remains usable and retryable.
    await expect(taskRoot(t.db, 'task1')).resolves.toBe(worktree)
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

  it('retains teardown success when worktree removal refuses archive, then records a fresh retry', async () => {
    await setTeardown('echo cleaned')
    writeFileSync(join(worktree, 'dirty.txt'), 'x')
    expect((await archiveTask(t.db, 'task1', {}, deps())).ok).toBe(false)
    const scripts = taskScripts(t.db)
    const first = scripts.status('task1').teardown
    expect(first).toMatchObject({ state: 'succeeded', exitCode: 0 })
    expect(scripts.logs('task1', { phase: 'teardown' }).output).toContain('cleaned')
    expect(scripts.status('task1').archiveInProgress).toBe(false)
    expect((await archiveTask(t.db, 'task1', { force: true }, deps())).ok).toBe(true)
    expect(scripts.status('task1').teardown.attemptId).not.toBe(first.attemptId)
    expect(scripts.logs('task1', { phase: 'teardown', attemptId: first.attemptId! }).snapshot.state).toBe('succeeded')
  })

  it('restoring a retained worktree gives fresh setup identity without rerunning a script', async () => {
    const root = join(dir, 'managed')
    mkdirSync(root)
    setWorktreesRoot(root)
    const managed = join(root, worktreeBranchDirName('acme', 'widget', 'feat/x'))
    git(checkout, 'worktree', 'move', worktree, managed)
    worktree = managed
    await t.db.update(schema.tasks).set({ worktreePath: managed }).where(eq(schema.tasks.id, 'task1'))
    const scripts = taskScripts(t.db)
    const old = scripts.admit('task1', 'setup')
    scripts.report({ attemptId: old.attemptId!, generation: old.generation }, { type: 'exit', exitCode: 0 })
    expect(await archiveTask(t.db, 'task1', { deleteWorktree: false }, deps())).toEqual({ ok: true })
    expect(await restoreTask(t.db, 'task1')).toEqual({ ok: true })
    const current = scripts.status('task1')
    expect(current.generation).toBeGreaterThan(old.generation)
    expect(current.setup.attemptId).toBeNull()
    expect(current.setup.state).toBe('unknown')
    expect(scripts.logs('task1', { phase: 'setup', attemptId: old.attemptId! }).snapshot.state).toBe('succeeded')
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
    const res = await archiveTask(
      t.db,
      'task1',
      { applyChecks: ['docker:containers:c'] },
      {
        ...deps(),
        applyTaskChecks: async (task, ids) => {
          seen.push({ ids, worktreeThere: existsSync(task.worktreePath!) })
          return []
        },
      },
    )
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
    const res = await archiveTask(
      t.db,
      'task1',
      { applyChecks: ['docker:containers:c'] },
      {
        ...deps(),
        applyTaskChecks: async () => ['docker'],
      },
    )
    // `ok` is true because the task is archived; offering a retry for something already done
    // would be worse than saying what did not happen.
    expect(res).toEqual({ ok: true, cleanupFailed: ['docker'] })
    const [row] = await t.db.select().from(schema.tasks)
    expect(row.status).toBe('archived')
  })

  it('never removes the project folder for a legacy checkout-marker task', async () => {
    await t.db.insert(schema.tasks).values({
      id: 'marker-task',
      title: 'Legacy checkout',
      origin: 'local',
      projectId: 'project-widget',
      branch: 'HEAD',
      worktreePath: checkout,
      status: 'active',
      sort: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: null,
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

  describe('restoreTask', () => {
    const archived = async () => {
      setWorktreesRoot(join(dir, 'worktrees'))
      writeFileSync(join(worktree, 'kept.txt'), 'committed')
      git(worktree, 'add', '.')
      git(worktree, 'commit', '-q', '-m', 'work')
      expect(await archiveTask(t.db, 'task1', {}, deps())).toEqual({ ok: true })
    }
    const row = async () => (await t.db.select().from(schema.tasks))[0]!

    it('rebuilds the worktree on the same branch, with its committed work', async () => {
      await archived()
      expect(await restoreTask(t.db, 'task1')).toEqual({ ok: true })
      const restored = await row()
      expect(restored.status).toBe('active')
      expect(restored.archivedAt).toBeNull()
      expect(readFileSync(join(restored.worktreePath!, 'kept.txt'), 'utf8')).toBe('committed')
    })

    it('asks before restoring onto a branch that no longer exists', async () => {
      await archived()
      git(checkout, 'branch', '-D', 'feat/x')
      const refused = await restoreTask(t.db, 'task1')
      expect(refused).toMatchObject({ ok: false, branchMissing: true })
      expect((await row()).status).toBe('archived')
      expect(await restoreTask(t.db, 'task1', { newBranch: true })).toEqual({ ok: true })
      expect((await row()).status).toBe('active')
    })

    it('stays archived when the branch is checked out somewhere else', async () => {
      await archived()
      git(checkout, 'worktree', 'add', '-q', join(dir, 'elsewhere'), 'feat/x')
      const refused = await restoreTask(t.db, 'task1')
      expect(refused.ok).toBe(false)
      const kept = await row()
      expect(kept.status).toBe('archived')
      expect(kept.archivedAt).not.toBeNull()
      expect(kept.worktreePath).toBeNull()
    })
  })
})
