import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../server/db'
import { makeTestDb, type TestDb } from '../server/routes/testDb'
import { loadTask, resolveTaskCwd, setOnWorktreeCreated, setWorktreesRoot } from './taskWorktree'

vi.setConfig({ testTimeout: 20_000 })

const TASK = '88888888-8888-4888-8888-888888888888'
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })

// The onWorktreeCreated hook is the single choke point that runs the workspace setup script: it
// must fire exactly once per task, on whichever path creates the worktree first — including two
// surfaces (a pane poll + a terminal open) racing in the same second.
describe('resolveTaskCwd onWorktreeCreated hook', () => {
  let t: TestDb
  let dir: string
  let checkout: string
  let created: string[]

  beforeEach(async () => {
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-taskwt-'))
    checkout = join(dir, 'checkout')
    execFileSync('git', ['init', '-b', 'main', checkout], { stdio: 'pipe' })
    git(checkout, 'config', 'user.email', 't@a.test')
    git(checkout, 'config', 'user.name', 'T')
    git(checkout, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(checkout, 'f.txt'), 'x\n')
    git(checkout, 'add', 'f.txt')
    git(checkout, 'commit', '-m', 'init')
    const now = Date.now()
    await t.db.insert(schema.tasks).values({ id: TASK, title: 'T', origin: 'local', repoOwner: 'acme', repoName: 'web', branch: 'feat-x', status: 'active', sort: 0, createdAt: now, updatedAt: now })
    setWorktreesRoot(join(dir, 'worktrees'))
    created = []
    setOnWorktreeCreated(async (task, cwd) => {
      created.push(`${task.id}:${cwd}`)
    })
  })
  afterEach(() => {
    setOnWorktreeCreated(async () => {})
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fires exactly once across concurrent creators, then never again on reuse', async () => {
    const task = await loadTask(t.db, TASK)
    const [a, b] = await Promise.all([resolveTaskCwd(t.db, task, checkout), resolveTaskCwd(t.db, task, checkout)])
    expect(a.isWorktree).toBe(true)
    expect(b.cwd).toBe(a.cwd)
    expect(created).toEqual([`${TASK}:${a.cwd}`])

    // Reuse — both via the persisted worktreePath and via a stale row that predates it.
    const fresh = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    const stale = await resolveTaskCwd(t.db, task, checkout)
    expect(fresh).toMatchObject({ cwd: a.cwd, created: false })
    expect(stale).toMatchObject({ cwd: a.cwd, created: false })
    expect(created).toHaveLength(1)
  })

  it('a failing hook does not break worktree resolution', async () => {
    setOnWorktreeCreated(async () => {
      throw new Error('setup exploded')
    })
    const res = await resolveTaskCwd(t.db, await loadTask(t.db, TASK), checkout)
    expect(res).toMatchObject({ isWorktree: true, created: true })
  })
})
