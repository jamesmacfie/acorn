import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema, type AppDatabase } from '../../server/db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { createTaskService } from './tasks'

// `workspaceId` vs `workspaceIdOrNull` — two answers to the same question, and the difference is what a caller
// does with "no workspace".
//
// The nullable form lets context assembly skip the workspace scope when a task's repository has no
// workspace, while still propagating genuine database failures.

const now = Date.now()

describe('the task service workspace lookups', () => {
  let t: TestDb
  let tasks: ReturnType<typeof createTaskService>

  beforeEach(async () => {
    t = makeTestDb()
    tasks = createTaskService(t.db)
    await t.db.insert(schema.tasks).values([
      { id: 'in-workspace', title: 'a', repoOwner: 'acme', repoName: 'widget', branch: 'b1', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0, origin: 'local', icon: null, createdAt: now, updatedAt: now },
      { id: 'no-workspace', title: 'b', repoOwner: 'acme', repoName: 'orphan', branch: 'b2', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 1, origin: 'local', icon: null, createdAt: now, updatedAt: now },
    ])
    await t.db.insert(schema.workspaceRepos).values({ workspaceId: 'ws1', repoOwner: 'acme', repoName: 'widget', sort: 0, createdAt: now })
  })
  afterEach(() => t.cleanup())

  it('resolves the workspace the same way in both forms', async () => {
    expect(await tasks.workspaceId('in-workspace')).toBe('ws1')
    expect(await tasks.workspaceIdOrNull('in-workspace')).toBe('ws1')
  })

  it('answers null where the throwing form throws — unknown task, and a repo in no workspace', async () => {
    await expect(tasks.workspaceId('nope')).rejects.toThrow(/Task not found/)
    await expect(tasks.workspaceId('no-workspace')).rejects.toThrow(/no workspace/)
    expect(await tasks.workspaceIdOrNull('nope')).toBeNull()
    expect(await tasks.workspaceIdOrNull('no-workspace')).toBeNull()
  })

  // The reason this is a second method rather than a `.catch(() => null)` at the call site. A caller that wants
  // "no workspace" as a value must not also get "the database is gone" as one.
  it('propagates a real database failure instead of reporting no workspace', async () => {
    const broken = {
      select: () => {
        throw new Error('The database connection is not open')
      },
    } as unknown as AppDatabase
    await expect(createTaskService(broken).workspaceIdOrNull('in-workspace')).rejects.toThrow(/connection is not open/)
  })
})
