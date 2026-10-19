// The agents data sources against this plugin's migrated database and core's own task and project
// rows (docs/data-sources.md).
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, schema as core, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import * as schema from '../../node/schema'
import { emptyAgentPricingPreferences } from '../../shared/pricing'
import { TURN_FACTS_VERSION } from '../sessions/turnFacts'
import { createSessionTotalsSourceHandler } from './sessionTotalsSourceHandler'
import { createTurnSourceHandler } from './turnSourceHandler'
import { createUsageSourceHandler } from './usageSourceHandler'
import { usageRecords } from './usageRecords'

const OCTOBER = Date.UTC(2026, 9, 1)
const context = { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, userId: 'owner' } as never

type Page = { records: { recordId: string; data: Record<string, unknown> }[]; completeness: { kind: string } }

const post = async (handler: PluginFetchHandler, body: object) => {
  const response = await handler(
    new Request('http://plugin/v1/p/agents/data', {
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
async function readAll(
  handler: PluginFetchHandler,
  sourceId: string,
  scope: { workspaceId?: string; projectId?: string },
  predicate?: DataPredicate,
) {
  const records: Page['records'] = []
  let cursor: string | undefined
  for (;;) {
    const page = (await post(handler, {
      operation: 'query',
      mode: 'execution',
      evaluationTime: Date.now(),
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
      query: {
        source: { pluginId: 'agents', sourceId },
        scope: { ...scope, parameters: {} },
        sort: [],
        ...(predicate ? { predicate } : {}),
      },
    })) as Page & { completeness: { cursor?: string } }
    records.push(...page.records)
    if (page.completeness.kind !== 'more') return { records, completeness: page.completeness }
    cursor = page.completeness.cursor
  }
}

const after = (pointer: string, value: number): DataPredicate => ({
  kind: 'comparison',
  left: { address: { from: 'item', pointer } },
  operator: 'gt',
  right: { address: { from: 'literal', value } },
})

describe('agents data sources', () => {
  let ctx: TestNodeContext
  let db: ReturnType<TestNodeContext['storage']['open']>

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    db = ctx.storage.open()
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
  const task = async (projectId: string, title: string, status = 'active') => {
    const id = randomUUID()
    await ctx.db.insert(core.tasks).values({
      id,
      title,
      origin: 'local',
      projectId,
      branch: null,
      worktreePath: null,
      status,
      createdAt: 1,
      updatedAt: 1,
    })
    return id
  }
  const session = (
    taskId: string,
    options: { provider?: string; title?: string; archivedAt?: number; historyRemovedAt?: number } = {},
  ) => {
    const id = randomUUID()
    db.insert(schema.agentSessions)
      .values({
        id,
        taskId,
        providerId: options.provider ?? 'codex',
        profileId: 'default',
        kind: 'interactive',
        driverKind: 'acp',
        driverVersion: '1',
        runtimeState: 'idle',
        statusAuthority: 'protocol',
        title: options.title ?? '',
        archivedAt: options.archivedAt ?? null,
        historyRemovedAt: options.historyRemovedAt ?? null,
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
    return id
  }
  const turn = (
    sessionId: string,
    taskId: string,
    projectId: string | null,
    values: Partial<typeof schema.agentTurnFacts.$inferInsert> & { ordinal: number; completedAt: number },
  ) => {
    const turnId = randomUUID()
    db.insert(schema.agentTurnFacts)
      .values({
        turnId,
        sessionId,
        taskId,
        projectId,
        firstSeq: null,
        provider: 'codex',
        model: 'gpt-6-sol',
        source: 'interactive',
        status: 'completed',
        startedAt: values.completedAt - 1_000,
        activeMs: 1_000,
        firstOutputMs: null,
        approvalWaitMs: 0,
        approvals: 0,
        toolCalls: 0,
        toolFailures: 0,
        longestFailureRun: 0,
        failureRunSeq: null,
        repeatedCalls: 0,
        repeatRunSeq: null,
        filesChanged: 0,
        filesRewritten: 0,
        subagents: 0,
        peakContextUsed: null,
        contextSize: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reportedCostUsd: null,
        version: TURN_FACTS_VERSION,
        ...values,
      })
      .run()
    return turnId
  }

  describe('Agent usage records', () => {
    it("returns this month's rows complete from 6,000 usage events, with deltas counted from before the month", async () => {
      const projectId = await project(await workspace('Home'), 'api')
      const taskId = await task(projectId, 'Long session')
      const sessionId = session(taskId)
      // Codex reports the session's running total, ten more input tokens each time: 5,000 reports in
      // September and 1,000 in October.
      const events = Array.from({ length: 6_000 }, (_, index) => ({
        id: randomUUID(),
        sessionId,
        turnId: null,
        seq: index + 1,
        schemaVersion: 1,
        eventJson: JSON.stringify({
          type: 'usage',
          usage: { inputTokens: (index + 1) * 10, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 },
        }),
        createdAt: OCTOBER + (index - 5_000) * 60_000,
      }))
      db.transaction((tx) => {
        for (const event of events) tx.insert(schema.agentEvents).values(event).run()
      })
      const handler = createUsageSourceHandler(db, ctx.core)

      const { records, completeness } = await readAll(handler, 'usage-records', {}, after('/at', OCTOBER - 1))
      expect(completeness).toEqual({ kind: 'complete' })
      expect(records).toHaveLength(1_000)
      expect(records.every((record) => record.data.inputTokens === 10)).toBe(true)

      // The same records an unbounded read of the whole history makes.
      const everything = usageRecords(
        events.map((event) => ({
          id: event.id,
          sessionId,
          turnId: null,
          taskId,
          provider: 'codex',
          model: null,
          at: event.createdAt,
          usage: JSON.parse(event.eventJson).usage,
        })),
        emptyAgentPricingPreferences(),
      )
      const october = new Map(everything.slice(5_000).map((record) => [record.recordId, record.data]))
      for (const record of records) expect(record.data).toEqual(october.get(record.recordId))

      // Without a window the newest 5,000 come back, marked as cut.
      const unbounded = (await post(handler, {
        operation: 'query',
        mode: 'execution',
        evaluationTime: Date.now(),
        pageSize: 100,
        query: { source: { pluginId: 'agents', sourceId: 'usage-records' }, scope: { parameters: {} }, sort: [] },
      })) as Page & { coveredRange: { start: number } }
      expect(unbounded.completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
      expect(unbounded.records[0]?.recordId).toBe(events.at(-1)?.id)
      expect(unbounded.coveredRange.start).toBe(events[1_000]?.createdAt)
    })
  })

  describe('Agent turns and Agent session totals', () => {
    it("shows a workspace's projects, and only its own", async () => {
      const home = await workspace('Home')
      const api = await project(home, 'api')
      const web = await project(home, 'web')
      const other = await project(await workspace('Other'), 'site')
      const apiTask = await task(api, 'Fix login')
      const webTask = await task(web, 'Restyle')
      const otherTask = await task(other, 'Elsewhere')
      for (const [taskId, projectId] of [
        [apiTask, api],
        [webTask, web],
        [otherTask, other],
      ] as const)
        turn(session(taskId), taskId, projectId, { ordinal: 1, completedAt: OCTOBER + 1, reportedCostUsd: 2 })
      const turns = createTurnSourceHandler(db, ctx.core)

      const inHome = await readAll(turns, 'turns', { workspaceId: home })
      expect(inHome.completeness).toEqual({ kind: 'complete' })
      expect(inHome.records.map((record) => [record.data.projectName, record.data.taskTitle]).sort()).toEqual([
        ['api', 'Fix login'],
        ['web', 'Restyle'],
      ])
      const inOther = await readAll(turns, 'turns', { workspaceId: (await ctx.core.projects.byId(other))!.workspaceId })
      expect(inOther.records.map((record) => record.data.projectName)).toEqual(['site'])
      const inWeb = await readAll(turns, 'turns', { workspaceId: home, projectId: web })
      expect(inWeb.records.map((record) => record.data.projectName)).toEqual(['web'])
      // A whole-Node read names the projects too.
      expect((await readAll(turns, 'turns', {})).records.map((record) => record.data.projectName).sort()).toEqual([
        'api',
        'site',
        'web',
      ])

      const totals = createSessionTotalsSourceHandler(db, ctx.core)
      expect((await readAll(totals, 'session-totals', { workspaceId: home, projectId: api })).records).toMatchObject([
        { data: { taskTitle: 'Fix login', projectName: 'api', costUsd: 2 } },
      ])
    })

    it('prices each turn: reported, estimated from tokens, or unknown', async () => {
      const projectId = await project(await workspace('Home'), 'api')
      const taskId = await task(projectId, 'Mixed')
      const claude = session(taskId, { provider: 'claude' })
      const codex = session(taskId)
      const reported = turn(claude, taskId, projectId, {
        ordinal: 1,
        completedAt: OCTOBER + 1,
        provider: 'claude',
        model: 'opus',
        reportedCostUsd: 0.5,
      })
      const silent = turn(claude, taskId, projectId, {
        ordinal: 2,
        completedAt: OCTOBER + 2,
        provider: 'claude',
        model: 'opus',
      })
      const estimated = turn(codex, taskId, projectId, {
        ordinal: 1,
        completedAt: OCTOBER + 3,
        inputTokens: 1_000_000,
        outputTokens: 1_000,
        peakContextUsed: 50_000,
        contextSize: 200_000,
      })
      const turns = createTurnSourceHandler(db, ctx.core)
      const byId = new Map((await readAll(turns, 'turns', {})).records.map((record) => [record.recordId, record.data]))
      expect(byId.get(reported)).toMatchObject({ costUsd: 0.5, costSource: 'reported' })
      expect(byId.get(silent)).toMatchObject({ costUsd: null, costSource: 'unknown' })
      expect(byId.get(estimated)).toMatchObject({ costSource: 'estimated', contextPeak: 25 })
      expect(byId.get(estimated)?.costUsd).toBeGreaterThan(0)

      // Model is a choice field: its options are the models the turns ran on.
      await expect(
        post(turns, {
          operation: 'options',
          source: { pluginId: 'agents', sourceId: 'turns' },
          scope: { parameters: {} },
          target: 'field',
          pointer: '/model',
        }),
      ).resolves.toEqual({
        options: [
          { id: 'gpt-6-sol', label: 'gpt-6-sol' },
          { id: 'opus', label: 'opus' },
        ],
        exhausted: true,
      })
      const onOpus = await readAll(
        turns,
        'turns',
        {},
        {
          kind: 'comparison',
          left: { address: { from: 'item', pointer: '/model' } },
          operator: 'eq',
          right: { address: { from: 'literal', value: 'opus' } },
        },
      )
      expect(onOpus.records.map((record) => record.recordId)).toEqual([silent, reported])
    })

    it('totals each session, archived ones and ones whose history was removed included', async () => {
      const projectId = await project(await workspace('Home'), 'api')
      const archivedTask = await task(projectId, 'Shipped', 'archived')
      const archived = session(archivedTask, { title: 'Ship it', archivedAt: OCTOBER })
      turn(archived, archivedTask, projectId, {
        ordinal: 1,
        completedAt: OCTOBER + 10,
        status: 'failed',
        toolCalls: 4,
        toolFailures: 3,
        longestFailureRun: 3,
        failureRunSeq: 12,
        reportedCostUsd: 1,
      })
      turn(archived, archivedTask, projectId, {
        ordinal: 2,
        completedAt: OCTOBER + 20,
        toolCalls: 6,
        repeatedCalls: 2,
        repeatRunSeq: 40,
        filesRewritten: 1,
        reportedCostUsd: 0.25,
      })
      // The retention pass removed this one's events and turns, and kept its row and its facts.
      const removed = session(archivedTask, { archivedAt: OCTOBER, historyRemovedAt: OCTOBER + 100 })
      turn(removed, archivedTask, projectId, { ordinal: 1, completedAt: OCTOBER - 86_400_000 })
      await ctx.db.insert(core.taskChangeRequests).values({
        taskId: archivedTask,
        provider: 'github',
        repoHost: 'github.com',
        repoPath: 'acme/api',
        number: 7,
        role: 'primary',
        provenance: 'agent',
        sessionId: archived,
        createdAt: 1,
      })
      const totals = createSessionTotalsSourceHandler(db, ctx.core)

      const all = await readAll(totals, 'session-totals', { projectId })
      expect(all.completeness).toEqual({ kind: 'complete' })
      expect(all.records.map((record) => record.recordId)).toEqual([archived, removed])
      expect(all.records[0]?.data).toMatchObject({
        title: 'Ship it',
        archived: true,
        taskStatus: 'archived',
        changeRequests: 1,
        turns: 2,
        failedTurns: 1,
        toolCalls: 10,
        toolFailures: 3,
        costUsd: 1.25,
        longestFailureRun: 3,
        longestFailureRunTurn: 1,
        longestFailureRunSeq: 12,
        repeatedCalls: 2,
        repeatedCallsTurn: 2,
        repeatedCallsSeq: 40,
        filesRewritten: 1,
        maxFilesRewritten: 1,
        firstStartedAt: OCTOBER + 10 - 1_000,
        lastCompletedAt: OCTOBER + 20,
      })
      expect(all.records[1]?.data).toMatchObject({
        title: 'codex',
        changeRequests: 0,
        turns: 1,
        costUsd: null,
        longestFailureRunTurn: null,
      })

      // A window on the last finished turn leaves out the session that ended before it.
      const october = await readAll(totals, 'session-totals', { projectId }, after('/lastCompletedAt', OCTOBER))
      expect(october.records.map((record) => record.recordId)).toEqual([archived])
    })
  })
})
