import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../db'
import { clearHooks, registerHookHandler } from '../pluginHost/hooks'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { computeTaskStatuses, loadTask, resolveTaskCwd, setWorktreesRoot } from './taskWorktree'
import { _resetWorktreeStatus, invalidateWorktreeStatus } from './worktreeStatus'

const broadcasts: Record<string, unknown>[] = []
vi.mock('../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../transport/wsHub')>()),
  wsBroadcast: (frame: Record<string, unknown>) => void broadcasts.push(frame),
}))

vi.setConfig({ testTimeout: 20_000 })

const TASK = '88888888-8888-4888-8888-888888888888'
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })

// `core:worktree-created` is the single choke point that runs the workspace setup script: it must fire
// exactly once per task, on whichever path creates the worktree first, including two surfaces (a pane
// poll and a terminal open) racing in the same second.
describe('resolveTaskCwd core:worktree-created hook', () => {
  let t: TestDb
  let dir: string
  let checkout: string
  let created: string[]

  let template: string

  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), 'acorn-task-wt-template-'))
    const src = join(template, 'checkout')
    execFileSync('git', ['init', '-b', 'main', src], { stdio: 'pipe' })
    git(src, 'config', 'user.email', 't@a.test')
    git(src, 'config', 'user.name', 'T')
    git(src, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(src, 'f.txt'), 'x')
    git(src, 'add', 'f.txt')
    git(src, 'commit', '-m', 'init')
  })

  afterAll(() => rmSync(template, { recursive: true, force: true }))

  beforeEach(async () => {
    // The coalesced status read is a module singleton, and these tests recreate a repo at a fresh path
    // per case (./worktreeStatus.ts).
    _resetWorktreeStatus()
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-taskwt-'))
    checkout = join(dir, 'checkout')
    // Base repo copied from a template built once in beforeAll: six fewer git spawns per test. The
    // worktrees these tests create are still real.
    cpSync(join(template, 'checkout'), checkout, { recursive: true })
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-web', name: 'web', path: checkout, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'web', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values({ id: TASK, title: 'T', origin: 'local', projectId: 'project-web', branch: 'feat-x', status: 'active', sort: 0, createdAt: now, updatedAt: now })
    setWorktreesRoot(join(dir, 'worktrees'))
    created = []
    clearHooks('setup')
    registerHookHandler({
      id: 'setup:record',
      pluginId: 'setup',
      point: 'core:worktree-created',
      mode: 'transform',
      priority: 500,
      call: async (payload) => {
        created.push(`${payload.taskId as string}:${payload.path as string}`)
        return { payload }
      },
    })
  })
  afterEach(() => {
    clearHooks('setup')
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fires exactly once across concurrent creators, then never again on reuse', async () => {
    const task = await loadTask(t.db, TASK)
    const [a, b] = await Promise.all([resolveTaskCwd(t.db, task, checkout), resolveTaskCwd(t.db, task, checkout)])
    expect(a.isWorktree).toBe(true)
    expect(b.cwd).toBe(a.cwd)
    expect(created).toEqual([`${TASK}:${a.cwd}`])

    // Reuse, both via the persisted worktreePath and via a stale row that predates it.
    const fresh = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    const stale = await resolveTaskCwd(t.db, task, checkout)
    expect(fresh).toMatchObject({ cwd: a.cwd, created: false })
    expect(stale).toMatchObject({ cwd: a.cwd, created: false })
    expect(created).toHaveLength(1)
  })

  it('a failing handler does not break worktree resolution', async () => {
    clearHooks('setup')
    registerHookHandler({
      id: 'setup:explode',
      pluginId: 'setup',
      point: 'core:worktree-created',
      mode: 'transform',
      priority: 500,
      call: async () => {
        throw new Error('setup exploded')
      },
    })
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    expect(res).toMatchObject({ isWorktree: true, created: true })
  })

  it('computes status for active worktrees after the bounded fan-out refactor', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    writeFileSync(join(res.cwd, 'f.txt'), 'changed\n')

    await expect(computeTaskStatuses(t.db)).resolves.toEqual([
      {
        taskId: TASK,
        worktreePath: res.cwd,
        dirty: true,
        dirtyCount: 1,
        missing: false,
        branch: expect.any(String),
        head: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ])
  })

  // The status poll is the HEAD observer (docs/plugins.md § Hearing a core event): the first
  // sighting seeds silently, a moved tip on the next pass broadcasts, an unmoved one does not.
  it('broadcasts head:changed when a worktree tip moves between polls', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    broadcasts.length = 0
    const [first] = await computeTaskStatuses(t.db)
    expect(broadcasts.filter((f) => f.channel === 'head:changed')).toEqual([])

    writeFileSync(join(res.cwd, 'g.txt'), 'new\n')
    git(res.cwd, 'add', 'g.txt')
    git(res.cwd, 'commit', '-m', 'move the tip')
    // This raw commit stands in for one typed into a terminal, and the terminal engine drops the
    // coalesced status read for the worktree on the same edge it announces the change on
    // (plugins/terminal/src/server/terminal.ts § worktreeSettled). Without that, two polls a
    // millisecond apart are one `git status` by design (./worktreeStatus.ts).
    invalidateWorktreeStatus(res.cwd)
    const [second] = await computeTaskStatuses(t.db)
    expect(second!.head).not.toBe(first!.head)
    expect(broadcasts.filter((f) => f.channel === 'head:changed')).toEqual([
      { channel: 'head:changed', projectId: expect.any(String), taskId: TASK, branch: second!.branch, head: second!.head, dirty: false },
    ])

    broadcasts.length = 0
    await computeTaskStatuses(t.db)
    expect(broadcasts.filter((f) => f.channel === 'head:changed')).toEqual([])
  })

  // A path persisted once was trusted forever, so a worktree that drifted kept serving the task
  // another branch's files, which is what put an agent in a tree that wasn't its task's. HEAD is now
  // the fact and the row follows it, because work that needs a second pull request switches branch
  // in the one worktree and the task has to survive that.
  it('adopts the branch its worktree has drifted onto', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    git(res.cwd, 'checkout', '-b', 'second-pr')
    broadcasts.length = 0

    const again = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    expect(again).toMatchObject({ cwd: res.cwd, isWorktree: true, created: false })
    expect((await loadTask(t.db, TASK))?.branch).toBe('second-pr')
    expect(broadcasts.filter((f) => f.channel === 'tasks:changed')).toEqual([{ channel: 'tasks:changed', taskId: TASK }])
  })

  // A detached HEAD has no branch to adopt, and a null branch means something else entirely: run in
  // the project root, on whatever the checkout is sitting on.
  it('refuses a worktree left on a detached HEAD', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    git(res.cwd, 'checkout', '--detach')

    await expect(resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)).rejects.toThrow(/no longer a live git worktree/)
    expect((await loadTask(t.db, TASK))?.branch).toBe('feat-x')
  })

  it('refuses a worktree directory whose git link is gone', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    rmSync(join(checkout, '.git', 'worktrees'), { recursive: true, force: true })

    await expect(resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)).rejects.toThrow(
      /no longer a live git worktree/,
    )
    expect(res.isWorktree).toBe(true)
  })

  // What the rail's "use the project folder and its current branch" tick produces: a Git project, but
  // no branch, so the task shares the checkout instead of getting a worktree.
  it('runs a branchless task in a Git project from the checkout without creating a worktree', async () => {
    await t.db.update(schema.tasks).set({ branch: null })
    const result = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    expect(result).toEqual({ cwd: checkout, isWorktree: false, created: false })
    expect(created).toEqual([])
  })

  it('runs a branchless task from the project root without creating a worktree', async () => {
    const plain = join(dir, 'plain')
    mkdirSync(plain)
    const now = Date.now()
    await t.db.insert(schema.projects).values({
      id: 'project-plain', name: 'plain', path: plain, workspaceId: 'workspace-1', sort: 1, hidden: false,
      vcs: null, defaultBranch: null, remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values({ id: 'plain-task', title: 'Plain', origin: 'local', projectId: 'project-plain', branch: null, status: 'active', sort: 0, createdAt: now, updatedAt: now })
    const result = await resolveTaskCwd(t.db, await loadTask(t.db, 'plain-task'), plain)
    expect(result).toEqual({ cwd: plain, isWorktree: false, created: false })
    expect(created).toEqual([])
  })
})
