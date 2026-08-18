import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../server/db'
import { CapabilityRegistry } from '../server/plugin/capabilities'
import { makeTestDb, type TestDb } from '../testkit/db'
import { baseRefPref, computeTaskStatuses, loadTask, resolveTaskCwd, setWorktreesRoot, WORKTREE_CREATED } from './taskWorktree'

vi.setConfig({ testTimeout: 20_000 })

const TASK = '88888888-8888-4888-8888-888888888888'
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })

describe('baseRefPref identity scope', () => {
  it('returns only the authenticated identity preference and fails closed without one', async () => {
    const t = makeTestDb()
    await t.db.insert(schema.prefs).values([
      { userId: 'alice', key: 'base_ref:project-web', value: 'origin/alice' },
      { userId: 'bob', key: 'base_ref:project-web', value: 'origin/bob' },
    ])

    await expect(baseRefPref(t.db, 'alice', 'project-web')).resolves.toBe('origin/alice')
    await expect(baseRefPref(t.db, 'bob', 'project-web')).resolves.toBe('origin/bob')
    await expect(baseRefPref(t.db, null, 'project-web')).resolves.toBeNull()
    t.cleanup()
  })
})

// The onWorktreeCreated hook is the single choke point that runs the workspace setup script: it
// must fire exactly once per task, on whichever path creates the worktree first — including two
// surfaces (a pane poll + a terminal open) racing in the same second.
describe('resolveTaskCwd onWorktreeCreated hook', () => {
  let t: TestDb
  let dir: string
  let checkout: string
  let created: string[]
  let capabilities: CapabilityRegistry

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
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-taskwt-'))
    checkout = join(dir, 'checkout')
    // Base repo copied from a template built once (beforeAll): six fewer git spawns per test. The
    // worktrees these tests create are still real — the subject is the created-hook firing exactly
    // once per task across concurrent resolution paths.
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
    capabilities = new CapabilityRegistry()
    capabilities.provide(WORKTREE_CREATED, async (task, cwd) => {
      created.push(`${task.id}:${cwd}`)
    })
  })
  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fires exactly once across concurrent creators, then never again on reuse', async () => {
    const task = await loadTask(t.db, TASK)
    const [a, b] = await Promise.all([resolveTaskCwd(t.db, task, checkout, null, capabilities), resolveTaskCwd(t.db, task, checkout, null, capabilities)])
    expect(a.isWorktree).toBe(true)
    expect(b.cwd).toBe(a.cwd)
    expect(created).toEqual([`${TASK}:${a.cwd}`])

    // Reuse — both via the persisted worktreePath and via a stale row that predates it.
    const fresh = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout, null, capabilities)
    const stale = await resolveTaskCwd(t.db, task, checkout, null, capabilities)
    expect(fresh).toMatchObject({ cwd: a.cwd, created: false })
    expect(stale).toMatchObject({ cwd: a.cwd, created: false })
    expect(created).toHaveLength(1)
  })

  it('a failing hook does not break worktree resolution', async () => {
    capabilities = new CapabilityRegistry()
    capabilities.provide(WORKTREE_CREATED, async () => {
      throw new Error('setup exploded')
    })
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout, null, capabilities)
    expect(res).toMatchObject({ isWorktree: true, created: true })
  })

  it('computes status for active worktrees after the bounded fan-out refactor', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout, null, capabilities)
    writeFileSync(join(res.cwd, 'f.txt'), 'changed\n')

    await expect(computeTaskStatuses(t.db)).resolves.toEqual([
      {
        taskId: TASK,
        worktreePath: res.cwd,
        dirty: true,
        dirtyCount: 1,
        missing: false,
      },
    ])
  })

  // The directory is keyed by owner/repo/branch and was trusted forever once persisted, so a worktree
  // that drifted kept serving the task another branch's files — what put an agent in a tree that was
  // not its task's. Both drifts (wrong branch, pruned admin dir) must refuse, not degrade.
  it('refuses a worktree that has drifted onto another branch', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout, null, capabilities)
    git(res.cwd, 'checkout', '-b', 'someone-elses-branch')

    await expect(resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout, null, capabilities)).rejects.toThrow(
      /checked out on 'someone-elses-branch', not 'feat-x'/,
    )
  })

  it('refuses a worktree directory whose git link is gone', async () => {
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout, null, capabilities)
    rmSync(join(checkout, '.git', 'worktrees'), { recursive: true, force: true })

    await expect(resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout, null, capabilities)).rejects.toThrow(
      /no longer a live git worktree/,
    )
    expect(res.isWorktree).toBe(true)
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
    const result = await resolveTaskCwd(t.db, await loadTask(t.db, 'plain-task'), plain, null, capabilities)
    expect(result).toEqual({ cwd: plain, isWorktree: false, created: false })
    expect(created).toEqual([])
  })
})
