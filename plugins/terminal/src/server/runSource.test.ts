// The Terminal runs source against this plugin's migrated database and core's own task and project rows
// (docs/terminal/run-targets.md § Run history).
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, schema as core, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { terminalRuns } from '../node/schema'
import { runSourceDescription } from '../shared/runSource'
import { deleteTaskRuns, recordRun, RUN_RECORD_CAP } from './runRecords'
import { createRunSourceHandler } from './runSource'

const OCTOBER = Date.UTC(2026, 9, 1)
const service = { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, userId: 'owner' } as never

type Page = {
  records: { recordId: string; taskId: string; data: Record<string, unknown> }[]
  completeness: { kind: string; cursor?: string }
}

const post = (handler: PluginFetchHandler, body: object, context = service) =>
  handler(
    new Request('http://plugin/v1/p/terminal/data/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context,
  )

/** Every page of a query, as a panel's run reads it. */
async function readAll(
  handler: PluginFetchHandler,
  scope: { workspaceId?: string; projectId?: string },
  options: { predicate?: DataPredicate; evaluationTime?: number } = {},
) {
  const records: Page['records'] = []
  let cursor: string | undefined
  for (;;) {
    const response = await post(handler, {
      operation: 'query',
      mode: 'execution',
      evaluationTime: options.evaluationTime ?? Date.now(),
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
      query: {
        source: { pluginId: 'terminal', sourceId: 'runs' },
        scope: { ...scope, parameters: {} },
        sort: [],
        ...(options.predicate ? { predicate: options.predicate } : {}),
      },
    })
    expect(response.status).toBe(200)
    const page = (await response.json()) as Page
    records.push(...page.records)
    if (page.completeness.kind !== 'more') return { records, completeness: page.completeness }
    cursor = page.completeness.cursor
  }
}

describe('Terminal runs source', () => {
  let ctx: TestNodeContext
  let db: ReturnType<TestNodeContext['storage']['open']>
  let handler: PluginFetchHandler

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'terminal' } })
    db = ctx.storage.open()
    handler = createRunSourceHandler(db, ctx.core)
  })
  afterEach(() => ctx.cleanup())

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
  const run = (taskId: string, finishedAt: number, exitCode: number | null = 0, name = 'web') =>
    recordRun(db, {
      id: randomUUID(),
      taskId,
      kind: 'target',
      name,
      exitCode,
      startedAt: finishedAt - 2_000,
      finishedAt,
    })

  it('gives each run its outcome, duration, task, and project, and nothing else', async () => {
    const taskId = await task(await project(await workspace('Home'), 'api'), 'Fix login')
    await run(taskId, OCTOBER + 3, 0)
    await run(taskId, OCTOBER + 2, 1)
    await run(taskId, OCTOBER + 1, null)

    const { records, completeness } = await readAll(handler, {})

    expect(completeness).toEqual({ kind: 'complete' })
    expect(records.map((record) => record.data.outcome).sort()).toEqual(['failed', 'killed', 'succeeded'])
    expect(records[0]).toMatchObject({
      taskId,
      data: { name: 'web', kind: 'target', durationMs: 2_000, taskTitle: 'Fix login', projectName: 'api' },
    })
    // The record carries exactly the declared fields: no command line, output, or environment.
    expect(Object.keys(records[0]!.data).sort()).toEqual(Object.keys(runSourceDescription.schema.properties!).sort())
  })

  it('reads only the runs of the tasks a workspace or project reaches', async () => {
    const home = await workspace('Home')
    const api = await project(home, 'api')
    const web = await project(home, 'web')
    const elsewhere = await project(await workspace('Work'), 'billing')
    await run(await task(api, 'API task'), OCTOBER)
    await run(await task(web, 'Web task'), OCTOBER)
    await run(await task(elsewhere, 'Billing task'), OCTOBER)

    const titles = async (scope: { workspaceId?: string; projectId?: string }) =>
      (await readAll(handler, scope)).records.map((record) => record.data.taskTitle).sort()
    expect(await titles({ workspaceId: home })).toEqual(['API task', 'Web task'])
    expect(await titles({ workspaceId: home, projectId: web })).toEqual(['Web task'])
    expect(await titles({ projectId: elsewhere })).toEqual(['Billing task'])
    expect(await titles({})).toEqual(['API task', 'Billing task', 'Web task'])
  })

  it("reads the query's time window and nothing past the evaluation time", async () => {
    const taskId = await task(await project(await workspace('Home'), 'api'), 'Task')
    for (const day of [0, 1, 2, 3]) await run(taskId, OCTOBER + day * 86_400_000, 0, `day-${day}`)
    const after = (value: number): DataPredicate => ({
      kind: 'comparison',
      left: { address: { from: 'item', pointer: '/finishedAt' } },
      operator: 'gt',
      right: { address: { from: 'literal', value } },
    })

    const { records } = await readAll(
      handler,
      {},
      { predicate: after(OCTOBER), evaluationTime: OCTOBER + 2 * 86_400_000 },
    )

    expect(records.map((record) => record.data.name).sort()).toEqual(['day-1', 'day-2'])
  })

  it('keeps the newest runs up to the cap, so a read of the whole table comes back complete', async () => {
    const taskId = await task(await project(await workspace('Home'), 'api'), 'Task')
    const rows = Array.from({ length: RUN_RECORD_CAP }, (_, index) => ({
      id: `run-${index}`,
      taskId,
      kind: 'target',
      name: 'web',
      exitCode: 0,
      startedAt: OCTOBER + index,
      finishedAt: OCTOBER + index,
    }))
    for (let start = 0; start < rows.length; start += 500)
      await db.insert(terminalRuns).values(rows.slice(start, start + 500))
    await run(taskId, OCTOBER + RUN_RECORD_CAP)

    const { records, completeness } = await readAll(handler, {})

    expect(records).toHaveLength(RUN_RECORD_CAP)
    expect(completeness).toEqual({ kind: 'complete' })
    expect(new Set(records.map((record) => record.recordId)).size).toBe(RUN_RECORD_CAP)
    expect(records.some((record) => record.recordId === 'run-0')).toBe(false)
    const last = (await (
      await post(handler, {
        operation: 'query',
        mode: 'execution',
        evaluationTime: OCTOBER + RUN_RECORD_CAP,
        pageSize: 100,
        query: { source: { pluginId: 'terminal', sourceId: 'runs' }, scope: { parameters: {} }, sort: [] },
      })
    ).json()) as { coveredRange?: { start: number } }
    // The cap dropped the first run, so the history starts at the oldest one kept.
    expect(last.coveredRange?.start).toBe(OCTOBER + 1)
  })

  it("removes a deleted task's runs and leaves the others", async () => {
    const api = await project(await workspace('Home'), 'api')
    const gone = await task(api, 'Gone')
    const kept = await task(api, 'Kept')
    await run(gone, OCTOBER)
    await run(gone, OCTOBER + 1)
    await run(kept, OCTOBER)

    expect(await deleteTaskRuns(db, [gone])).toBe(2)
    expect((await db.select().from(terminalRuns)).map((row) => row.taskId)).toEqual([kept])
  })

  it('refuses a task principal', async () => {
    const response = await post(
      handler,
      { operation: 'describe' } as object,
      {
        principal: { kind: 'internal', scope: 'task', taskId: 't' },
        userId: 'owner',
      } as never,
    )
    expect(response.status).toBe(403)
  })
})
