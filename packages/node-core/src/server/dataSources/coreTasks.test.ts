import { afterEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '../activeIdentity'
import { schema } from '../db'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { invokeDataSource } from './runtime'
import { coreTaskSourceDescription } from './coreTasks'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'

const worlds: TestDb[] = []
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup()
})

const PERSON_TASK = '22222222-2222-4222-8222-222222222222'
const AGENT_TASK = '33333333-3333-4333-8333-333333333333'
const PARENT_TASK = '44444444-4444-4444-8444-444444444444'

const seedProject = async () => {
  const world = makeTestDb()
  worlds.push(world)
  const now = Date.now()
  await world.db
    .insert(schema.workspaces)
    .values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await world.db.insert(schema.projects).values({
    id: 'project',
    name: 'Project',
    path: '/tmp/project',
    workspaceId: 'ws',
    sort: 0,
    hidden: false,
    vcs: 'git',
    defaultBranch: 'main',
    remoteUrl: null,
    githubOwner: null,
    githubName: null,
    githubRepoId: null,
    createdAt: now,
    updatedAt: now,
  })
  return { world, now }
}

const queryTasks = (world: TestDb, now: number, predicate?: DataPredicate) =>
  invokeDataSource(
    testEnv({ DB: world.db, ACTIVE_IDENTITY: memoryIdentityStore('owner') }),
    {
      operation: 'query',
      mode: 'execution',
      evaluationTime: now,
      pageSize: 25,
      query: {
        source: { pluginId: 'core', sourceId: 'tasks' },
        scope: { workspaceId: 'ws', parameters: {} },
        ...(predicate ? { predicate } : {}),
        sort: [],
      },
    },
    {
      principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' },
      signal: new AbortController().signal,
    },
  )

describe('core task data source', () => {
  it('queries through the shared runtime and represents uninspected worktree state as null', async () => {
    const { world, now } = await seedProject()
    await world.db.insert(schema.tasks).values({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Implement transition',
      origin: 'local',
      projectId: 'project',
      branch: 'workflow-v2',
      worktreePath: '/tmp/project-worktree',
      pullNumber: null,
      status: 'active',
      parentId: null,
      sort: 0,
      createdAt: now,
      updatedAt: now,
    })
    const page = await queryTasks(world, now)
    expect(page.records).toEqual([
      expect.objectContaining({
        ref: expect.objectContaining({
          pluginId: 'core',
          sourceId: 'tasks',
          recordId: '11111111-1111-4111-8111-111111111111',
        }),
        data: expect.objectContaining({ title: 'Implement transition', worktreeChanged: null }),
        taskId: '11111111-1111-4111-8111-111111111111',
        action: { verb: 'openTask' },
      }),
    ])
  })

  it("marks a task an agent made with the task that made it, and leaves it off a person's", async () => {
    const { world, now } = await seedProject()
    const task = { projectId: 'project', status: 'active', sort: 0, createdAt: now, updatedAt: now }
    await world.db.insert(schema.tasks).values([
      { ...task, id: PERSON_TASK, title: 'Made by a person', origin: 'manual' },
      { ...task, id: AGENT_TASK, title: 'Made by an agent', origin: 'agent', createdByTaskId: PARENT_TASK },
    ])
    const createdByTask = { address: { from: 'item' as const, pointer: '/createdByTask' } }
    const where = (operator: 'present' | 'missing'): DataPredicate => ({
      kind: 'comparison',
      left: createdByTask,
      operator,
    })

    const all = await queryTasks(world, now)
    const dataOf = (id: string) => all.records.find((record) => record.ref.recordId === id)?.data
    expect(dataOf(AGENT_TASK)).toMatchObject({ createdByTask: PARENT_TASK })
    expect(dataOf(PERSON_TASK)).not.toHaveProperty('createdByTask')
    const titles = async (operator: 'present' | 'missing') =>
      (await queryTasks(world, now, where(operator))).records.map((record) => record.display?.title)
    expect(await titles('present')).toEqual(['Made by an agent'])
    expect(await titles('missing')).toEqual(['Made by a person'])
  })

  it('offers starter plans that fit its own description', () => {
    expect(coreTaskSourceDescription.starterPlans?.length).toBeGreaterThan(0)
    for (const starter of coreTaskSourceDescription.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map((source) => {
        if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
        return {
          instanceId: source.id,
          label: source.label,
          query: source.reference.content.query,
          description: coreTaskSourceDescription,
        }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
  })
})
