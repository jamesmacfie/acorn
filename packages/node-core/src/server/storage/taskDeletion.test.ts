import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import { createTaskService } from '../core/tasks'
import { beginTaskArchive, finishTaskArchive } from '../worktrees/archiveGate'
import { restoreTask } from './archive'
import { deleteTask } from './taskDeletion'

// Lets a test run work in the gap after restoreTask has read the task and before it writes.
const projectLookup = vi.hoisted(() => ({ during: null as null | (() => Promise<unknown>) }))
vi.mock('../worktrees/taskWorktree', async (original) => {
  const actual = await original<typeof import('../worktrees/taskWorktree')>()
  return {
    ...actual,
    projectForTask: async (...args: Parameters<typeof actual.projectForTask>) => {
      await projectLookup.during?.()
      return actual.projectForTask(...args)
    },
  }
})

describe('deleteTask', () => {
  let t: TestDb

  const insertTask = async (id: string, status: 'active' | 'archived', parentId: string | null = null) => {
    const now = Date.now()
    await t.db.insert(schema.tasks).values({
      id, title: id, origin: 'local', projectId: 'project-1', branch: null, worktreePath: null, pullNumber: null,
      status, parentId, sort: 0, createdAt: now, updatedAt: now, archivedAt: status === 'archived' ? now : null,
    })
  }
  const taskIds = async () => (await t.db.select({ id: schema.tasks.id }).from(schema.tasks)).map((row) => row.id).sort()
  const refuseArchive = vi.fn(async () => ({ ok: false as const, reason: 'Stop 1 running session first.' }))

  beforeEach(async () => {
    t = makeTestDb()
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'ws1', name: 'W', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-1', name: 'widget', path: null, workspaceId: 'ws1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    refuseArchive.mockClear()
  })

  afterEach(() => {
    projectLookup.during = null
    t.cleanup()
  })

  it('deletes an archived task and its subtasks, their core rows and prefs, and leaves tombstones', async () => {
    await insertTask('parent', 'archived')
    await insertTask('child', 'archived', 'parent')
    await insertTask('other', 'archived')
    await t.db.insert(schema.taskLinks).values({ taskId: 'child', integrationId: 'i1', provider: 'linear', identifier: 'ENG-1', createdAt: 0 })
    await t.db.insert(schema.prefs).values([
      { userId: 'u', key: 'core:task-layouts:node-1/parent', value: '{}' },
      { userId: 'u', key: 'core:task-layouts:child', value: '{}' },
      { userId: 'u', key: 'core:task-layouts:node-1/other', value: '{}' },
    ])
    const taskDeleted = vi.fn(async () => {})

    const result = await deleteTask(t.db, 'parent', { archive: refuseArchive, taskDeleted })

    expect(result).toEqual({ ok: true, taskIds: ['child', 'parent'] })
    expect(refuseArchive).not.toHaveBeenCalled()
    expect(taskDeleted).toHaveBeenCalledWith(['child', 'parent'])
    expect(await taskIds()).toEqual(['other'])
    expect(await t.db.select().from(schema.taskLinks)).toEqual([])
    expect((await t.db.select().from(schema.prefs)).map((pref) => pref.key)).toEqual(['core:task-layouts:node-1/other'])
    expect((await createTaskService(t.db).deleted()).sort()).toEqual(['child', 'parent'])
  })

  it('archives an active task first, and deletes nothing when that archive refuses', async () => {
    await insertTask('task', 'active')

    const refused = await deleteTask(t.db, 'task', { archive: refuseArchive })

    expect(refused).toEqual({ ok: false, reason: 'Stop 1 running session first.' })
    expect(await taskIds()).toEqual(['task'])

    const archive = async () => {
      await t.db.update(schema.tasks).set({ status: 'archived', archivedAt: Date.now() }).where(eq(schema.tasks.id, 'task'))
      return { ok: true as const, cleanupFailed: ['docker'] }
    }
    expect(await deleteTask(t.db, 'task', { archive })).toEqual({ ok: true, taskIds: ['task'], cleanupFailed: ['docker'] })
    expect(await taskIds()).toEqual([])
  })

  it('refuses while an archive holds the task', async () => {
    await insertTask('task', 'archived')
    beginTaskArchive('task')
    try {
      expect(await deleteTask(t.db, 'task', { archive: refuseArchive })).toMatchObject({ ok: false, busy: true })
    } finally {
      finishTaskArchive('task')
    }
    expect(await taskIds()).toEqual(['task'])
  })

  it('refuses a restore whose task was deleted while it ran', async () => {
    await insertTask('task', 'archived')
    projectLookup.during = () => deleteTask(t.db, 'task', { archive: refuseArchive })

    expect(await restoreTask(t.db, 'task')).toMatchObject({ ok: false, busy: true })
    expect(await taskIds()).toEqual([])
  })
})
