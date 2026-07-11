import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../../../core/server/db'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { WorktreeService } from './worktreeService'

vi.setConfig({ testTimeout: 20_000 })

const TASK = '99999999-9999-4999-8999-999999999999'
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })

describe('WorktreeService', () => {
  let t: TestDb
  let dir: string
  let svc: WorktreeService

  beforeEach(async () => {
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-wtsvc-'))
    execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' })
    git(dir, 'config', 'user.email', 't@a.test')
    git(dir, 'config', 'user.name', 'T')
    git(dir, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(dir, 'f.txt'), 'x\n')
    git(dir, 'add', 'f.txt')
    git(dir, 'commit', '-m', 'init')
    const now = Date.now()
    await t.db.insert(schema.repoPaths).values({ owner: 'acme', repo: 'web', path: dir, createdAt: now, updatedAt: now })
    await t.db.insert(schema.tasks).values({ id: TASK, title: 'T', origin: 'local', repoOwner: 'acme', repoName: 'web', branch: 'main', status: 'active', sort: 0, createdAt: now, updatedAt: now })
    svc = new WorktreeService(t.db)
  })
  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports no worktree before one exists', async () => {
    expect(await svc.status(TASK)).toEqual({ taskId: TASK, worktreePath: null, isWorktree: false, branch: null, dirty: false, dirtyCount: 0, missing: false })
  })

  it('adopts the current checkout and reports its branch + dirty state', async () => {
    const adopted = await svc.adoptCheckout(TASK)
    expect(adopted.worktreePath).toBe(dir)
    expect(adopted.branch).toBe('main')
    expect(adopted.dirty).toBe(false)

    // dirty the checkout → status reflects it
    writeFileSync(join(dir, 'f.txt'), 'changed\n')
    const status = await svc.status(TASK)
    expect(status).toMatchObject({ isWorktree: true, dirty: true, dirtyCount: 1 })

    // removing an adopted checkout just detaches (does not delete the git checkout)
    await svc.remove(TASK, false)
    expect((await svc.status(TASK)).worktreePath).toBeNull()
  })

  it('404s an unknown task', async () => {
    await expect(svc.status('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'not_found' })
  })
})
