import { afterEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '../activeIdentity'
import { schema } from '../db'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { invokeDataSource } from './runtime'
import { coreTaskSourceDescription } from './coreTasks'

const worlds: TestDb[] = []
afterEach(() => { for (const world of worlds.splice(0)) world.cleanup() })

describe('core task data source', () => {
  it('queries through the shared runtime and represents uninspected worktree state as null', async () => {
    const world = makeTestDb()
    worlds.push(world)
    const now = Date.now()
    await world.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await world.db.insert(schema.projects).values({
      id: 'project', name: 'Project', path: '/tmp/project', workspaceId: 'ws', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null,
      githubRepoId: null, createdAt: now, updatedAt: now,
    })
    await world.db.insert(schema.tasks).values({
      id: '11111111-1111-4111-8111-111111111111', title: 'Implement transition', origin: 'local', projectId: 'project', branch: 'workflow-v2',
      worktreePath: '/tmp/project-worktree', pullNumber: null, status: 'active', parentId: null, sort: 0,
      createdAt: now, updatedAt: now,
    })
    const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: memoryIdentityStore('owner') })
    const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal }
    const page = await invokeDataSource(env, {
      operation: 'query', mode: 'execution', evaluationTime: now, pageSize: 25,
      query: { source: { pluginId: 'core', sourceId: 'tasks' }, scope: { workspaceId: 'ws', parameters: {} }, sort: [] },
    }, invocation)
    expect(page.records).toEqual([expect.objectContaining({
      ref: expect.objectContaining({ pluginId: 'core', sourceId: 'tasks', recordId: '11111111-1111-4111-8111-111111111111' }),
      data: expect.objectContaining({ title: 'Implement transition', worktreeChanged: null }),
      taskId: '11111111-1111-4111-8111-111111111111', action: { verb: 'openTask' },
    })])
  })

  it('offers starter plans that fit its own description', () => {
    expect(coreTaskSourceDescription.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of coreTaskSourceDescription.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map(source => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return { instanceId: source.id, label: source.label, query: source.reference.content.query, description: coreTaskSourceDescription }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
