import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import { projectSetup } from '../worktrees/taskWorktree'
import { taskScripts } from './service'
import { recordSetupDecision } from './setup'

// An untrusted project never runs setup (docs/workspaces-and-tasks/projects.md § Untrusted projects).
describe('setup in an untrusted project', () => {
  let t: TestDb
  beforeEach(() => {
    t = makeTestDb()
    t.db
      .insert(schema.projects)
      .values({
        id: 'p',
        name: 'Project',
        workspaceId: 'w',
        vcs: 'git',
        setupScript: 'pnpm install',
        setupScriptTrigger: 'created',
        trusted: false,
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
    t.db
      .insert(schema.tasks)
      .values({
        id: 'task',
        title: 'Fixture',
        projectId: 'p',
        branch: 'feature',
        origin: 'local',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
  })
  afterEach(() => {
    taskScripts(t.db).close()
    t.cleanup()
  })

  it('reads as off and records the skip, then runs once the project is trusted', async () => {
    expect(await projectSetup(t.db, 'p')).toEqual({ script: null, trigger: 'off' })
    await recordSetupDecision(t.db, 'task', false)
    expect(taskScripts(t.db).select('task', 'setup')).toMatchObject({ state: 'skipped', reason: 'disabled' })

    t.db.update(schema.projects).set({ trusted: true }).run()
    expect(await projectSetup(t.db, 'p')).toEqual({ script: 'pnpm install', trigger: 'created' })
  })
})
