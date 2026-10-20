// The Workflow runs data source against this plugin's migrated database and core's own task and
// project rows (docs/workflows.md § Workflow runs source).
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeTestNodeContext, schema as core, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import * as schema from '../../node/schema'
import { createRunSourceHandler } from './runSourceHandler'

const OCTOBER = Date.UTC(2026, 9, 1)
const context = { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, userId: 'owner' } as never

type Page = {
  records: { recordId: string; data: Record<string, unknown>; target?: unknown }[]
  completeness: { kind: string; cursor?: string }
  coveredRange?: { start: number }
}

let ctx: TestNodeContext
let db: ReturnType<TestNodeContext['storage']['open']>
let handler: PluginFetchHandler

beforeEach(() => {
  ctx = makeTestNodeContext({ plugin: { name: 'workflows' } })
  db = ctx.storage.open()
  handler = createRunSourceHandler(db, ctx.core)
})
afterEach(() => ctx.cleanup())

const post = async (body: object) => {
  const response = await handler(
    new Request('http://plugin/v1/p/workflows/data/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context,
  )
  expect(response.status).toBe(200)
  return response.json()
}

/** Every page of a query, as a panel's run reads it. */
async function readAll(scope: { workspaceId?: string; projectId?: string }, predicate?: DataPredicate) {
  const records: Page['records'] = []
  let cursor: string | undefined
  for (;;) {
    const page = (await post({
      operation: 'query',
      mode: 'execution',
      evaluationTime: Date.now(),
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
      query: {
        source: { pluginId: 'workflows', sourceId: 'runs' },
        scope: { ...scope, parameters: {} },
        sort: [],
        ...(predicate ? { predicate } : {}),
      },
    })) as Page
    records.push(...page.records)
    if (page.completeness.kind !== 'more') return { records, completeness: page.completeness }
    cursor = page.completeness.cursor
  }
}

const compare = (pointer: string, operator: 'gt' | 'eq', value: number | string): DataPredicate => ({
  kind: 'comparison',
  left: { address: { from: 'item', pointer } },
  operator,
  right: { address: { from: 'literal', value } },
})

const workspace = async (name: string) => {
  const id = randomUUID()
  await ctx.db.insert(core.workspaces).values({ id, name, createdAt: 1, updatedAt: 1 })
  return id
}
const project = async (workspaceId: string, name: string) => {
  const id = randomUUID()
  await ctx.db.insert(core.projects).values({
    id,
    name,
    path: null,
    workspaceId,
    sort: 0,
    hidden: false,
    vcs: 'git',
    defaultBranch: 'main',
    remoteUrl: null,
    githubOwner: null,
    githubName: null,
    githubRepoId: null,
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}
const task = async (projectId: string, title: string) => {
  const id = randomUUID()
  await ctx.db.insert(core.tasks).values({
    id,
    title,
    origin: 'local',
    projectId,
    branch: null,
    worktreePath: null,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}
const run = (taskId: string, values: Partial<typeof schema.workflowRuns.$inferInsert> & { createdAt: number }) => {
  const id = values.id ?? randomUUID()
  return {
    taskId,
    name: 'Review',
    status: 'done',
    defJson: '{}',
    rootRunId: id,
    updatedAt: values.createdAt + 60_000,
    ...values,
    id,
  }
}

it("reads a workspace's runs, and only its own, with their task and project", async () => {
  const home = await workspace('Home')
  const api = await project(home, 'api')
  const web = await project(home, 'web')
  const other = await project(await workspace('Other'), 'site')
  const apiTask = await task(api, 'Fix login')
  const webTask = await task(web, 'Restyle')
  const otherTask = await task(other, 'Elsewhere')
  await db
    .insert(schema.workflowRuns)
    .values([
      run(apiTask, { createdAt: OCTOBER }),
      run(webTask, { createdAt: OCTOBER }),
      run(otherTask, { createdAt: OCTOBER }),
    ])

  const inHome = await readAll({ workspaceId: home })
  expect(inHome.completeness).toEqual({ kind: 'complete' })
  expect(inHome.records.map((record) => [record.data.projectName, record.data.taskTitle]).sort()).toEqual([
    ['api', 'Fix login'],
    ['web', 'Restyle'],
  ])
  const inWeb = await readAll({ workspaceId: home, projectId: web })
  expect(inWeb.records.map((record) => record.data.projectName)).toEqual(['web'])
  // A whole-Node read looks each run's task up instead.
  expect((await readAll({})).records.map((record) => record.data.projectName).sort()).toEqual(['api', 'site', 'web'])
})

it('shapes a record: duration once settled, a short error, and a child run', async () => {
  const taskId = await task(await project(await workspace('Home'), 'api'), 'Fix login')
  const root = run(taskId, {
    createdAt: OCTOBER,
    status: 'failed',
    startedBy: 'schedule',
    error: `Step 'Test' failed.\n${'    at frame\n'.repeat(50)}`,
  })
  const child = run(taskId, {
    createdAt: OCTOBER + 1_000,
    name: 'Child',
    status: 'running',
    rootRunId: root.id,
    parentRunId: root.id,
    depth: 1,
  })
  await db.insert(schema.workflowRuns).values([root, child])

  const { records } = await readAll({ projectId: (await ctx.core.tasks.load(taskId))!.projectId })
  expect(records.map((record) => record.recordId)).toEqual([child.id, root.id])
  expect(records[1]).toMatchObject({
    data: {
      runId: root.id,
      name: 'Review',
      status: 'failed',
      trigger: 'schedule',
      taskId,
      taskTitle: 'Fix login',
      projectName: 'api',
      parentRunId: null,
      depth: 0,
      error: "Step 'Test' failed.",
      createdAt: OCTOBER,
      updatedAt: OCTOBER + 60_000,
      durationMs: 60_000,
    },
    target: { kind: 'workflows.run', item: root.id },
  })
  expect(records[0]?.data).toMatchObject({ parentRunId: root.id, depth: 1, durationMs: null, error: null })

  // Workflow is a choice field: its options are the names the runs carry.
  await expect(
    post({
      operation: 'options',
      source: { pluginId: 'workflows', sourceId: 'runs' },
      scope: { parameters: {} },
      target: 'field',
      pointer: '/name',
    }),
  ).resolves.toEqual({
    options: [
      { id: 'Child', label: 'Child' },
      { id: 'Review', label: 'Review' },
    ],
    exhausted: true,
  })
})

it('reads the window complete past the budget, and marks an unbounded read cut', async () => {
  const home = await workspace('Home')
  const taskId = await task(await project(home, 'api'), 'Busy')
  // A run a minute for the 5,000 before October and 100 more after it.
  const total = DATA_LIMITS.selectionRecords + 100
  const rows = Array.from({ length: total }, (_, index) =>
    run(taskId, { createdAt: OCTOBER + (index - DATA_LIMITS.selectionRecords) * 60_000 }),
  )
  db.transaction((tx) => {
    for (const row of rows) tx.insert(schema.workflowRuns).values(row).run()
  })

  const october = await readAll({ workspaceId: home }, compare('/createdAt', 'gt', OCTOBER - 1))
  expect(october.completeness).toEqual({ kind: 'complete' })
  expect(october.records).toHaveLength(100)

  // The equality filters reach SQL too, so a filtered read fits the budget.
  const none = await readAll({ workspaceId: home }, compare('/status', 'eq', 'failed'))
  expect(none).toEqual({ records: [], completeness: { kind: 'complete' } })

  const unbounded = (await post({
    operation: 'query',
    mode: 'execution',
    evaluationTime: Date.now(),
    pageSize: 100,
    query: {
      source: { pluginId: 'workflows', sourceId: 'runs' },
      scope: { workspaceId: home, parameters: {} },
      sort: [],
    },
  })) as Page
  // The host stops at the first page that isn't `more`, so the cut shows on the last page.
  expect(unbounded.completeness).toEqual({ kind: 'more', cursor: '100' })
  expect(unbounded.records[0]?.recordId).toBe(rows.at(-1)?.id)
  expect(unbounded.coveredRange?.start).toBe(rows[100]?.createdAt)
  const cut = await readAll({ workspaceId: home })
  expect(cut.completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
  expect(cut.records).toHaveLength(DATA_LIMITS.selectionRecords)
})
