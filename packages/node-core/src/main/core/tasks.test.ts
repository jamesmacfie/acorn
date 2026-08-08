import { eq } from 'drizzle-orm'
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
    await t.db.insert(schema.workspaces).values({ id: 'ws1', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: null, workspaceId: 'ws1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values([
      { id: 'in-workspace', title: 'a', projectId: 'project-widget', branch: 'b1', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0, origin: 'local', icon: null, createdAt: now, updatedAt: now },
      { id: 'no-workspace', title: 'b', projectId: 'missing-project', branch: 'b2', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 1, origin: 'local', icon: null, createdAt: now, updatedAt: now },
    ])
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

describe('createChild project inheritance', () => {
  let t: TestDb

  beforeEach(() => {
    t = makeTestDb()
  })

  afterEach(() => t.cleanup())

  it('creates a branchless child for a non-Git project', async () => {
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-plain', name: 'Plain', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-plain', name: 'notes', path: '/tmp/acorn-notes', workspaceId: 'workspace-plain', sort: 0, hidden: false,
      vcs: null, defaultBranch: null, remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await t.db.insert(schema.tasks).values({
      id: 'plain-parent', title: 'Parent', origin: 'local', projectId: 'project-plain',
      branch: null, worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: now, updatedAt: now,
    })

    const childId = await createTaskService(t.db).createChild('plain-parent', { title: 'Child', branch: 'child-feature' })
    const [child] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, childId))

    expect(child).toMatchObject({
      projectId: 'project-plain', branch: null, parentId: 'plain-parent', status: 'active',
    })
  })
})

describe('adoptPullNumbers project matching', () => {
  let t: TestDb

  beforeEach(() => {
    t = makeTestDb()
  })

  afterEach(() => t.cleanup())

  it('adopts the same PR number across every matching project clone', async () => {
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-github', name: 'GitHub', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values([
      { id: 'project-one', name: 'one', path: '/tmp/one', workspaceId: 'workspace-github', sort: 0, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/widget.git', githubOwner: 'acme', githubName: 'widget', githubRepoId: 1, createdAt: now, updatedAt: now },
      { id: 'project-two', name: 'two', path: '/tmp/two', workspaceId: 'workspace-github', sort: 1, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/widget.git', githubOwner: 'Acme', githubName: 'Widget', githubRepoId: 1, createdAt: now + 1, updatedAt: now + 1 },
    ])
    await t.db.insert(schema.tasks).values([
      { id: 'clone-one-task', title: 'one', origin: 'github-pr', projectId: 'project-one', branch: 'fix-one', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: now, updatedAt: now },
      { id: 'clone-two-task', title: 'two', origin: 'github-pr', projectId: 'project-two', branch: 'fix-one', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 1, createdAt: now, updatedAt: now },
    ])

    const adopted = await createTaskService(t.db).adoptPullNumbers('ACME', 'WIDGET', new Map([['fix-one', 42]]))
    expect(adopted).toBe(2)
    const rows = await t.db.select({ id: schema.tasks.id, pullNumber: schema.tasks.pullNumber }).from(schema.tasks)
    expect(rows).toEqual(expect.arrayContaining([
      { id: 'clone-one-task', pullNumber: 42 },
      { id: 'clone-two-task', pullNumber: 42 },
    ]))
  })
})
