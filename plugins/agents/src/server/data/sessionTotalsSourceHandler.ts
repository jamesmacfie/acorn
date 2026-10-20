import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  createDataSourceHandler,
  DATA_READ_LIMIT,
  pageDataRecords,
  sqlDataFilters,
  withinDataBudget,
  type CoreServices,
  type PluginDatabase,
  type PluginFetchHandler,
} from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import { sessionTotalsSourceDescription } from '../../shared/sessionTotalsSource'
import { readAgentPricingPreferences } from '../pricingStore'
import { turnFactsPending } from '../sessions/turnFactsBackfill'
import { scopeTasks, tasksOfRows } from './scopeTasks'
import { contextPeak, turnCost } from './turnSourceHandler'
import { AGENT_PANE_ID } from '../../shared/paneIdentity'

const facts = schema.agentTurnFacts
const lastCompletedAt = sql<number>`max(${facts.completedAt})`
// Every field here is the same on all of a session's turns, so filtering turns filters whole sessions.
// The time field is an aggregate, so it filters in `having`.
const fields = {
  time: { pointer: '/lastCompletedAt', column: lastCompletedAt },
  equals: {
    '/taskId': facts.taskId,
    '/sessionId': facts.sessionId,
    '/projectId': facts.projectId,
    '/provider': facts.provider,
  },
}

type Turn = typeof facts.$inferSelect

/** The turn with the highest `pick`, the first of them on a tie, or null when every turn has 0. */
const worst = (turns: Turn[], pick: (turn: Turn) => number): Turn | null =>
  turns.reduce<Turn | null>((best, turn) => (pick(turn) > (best ? pick(best) : 0) ? turn : best), null)

export function createSessionTotalsSourceHandler(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects' | 'prefs'>,
): PluginFetchHandler {
  return createDataSourceHandler({
    description: sessionTotalsSourceDescription,
    coverageComplete: () => !turnFactsPending(db),
    failure: 'agent_session_totals_source_failed',
    query: async (input, context) => {
      const scoped = await scopeTasks(core, input.query.scope)
      const { time, equals } = sqlDataFilters(input.query.predicate, fields)
      const sessions = withinDataBudget(
        await db
          .select({ id: facts.sessionId })
          .from(facts)
          .where(and(...equals, scoped ? inArray(facts.taskId, [...scoped.keys()]) : undefined))
          .groupBy(facts.sessionId)
          .having(and(...time))
          .orderBy(desc(lastCompletedAt), desc(facts.sessionId))
          .limit(DATA_READ_LIMIT),
      )
      const rows = await db
        .select({
          turn: facts,
          title: schema.agentSessions.title,
          kind: schema.agentSessions.kind,
          archivedAt: schema.agentSessions.archivedAt,
        })
        .from(facts)
        .innerJoin(schema.agentSessions, eq(facts.sessionId, schema.agentSessions.id))
        .where(
          inArray(
            facts.sessionId,
            sessions.rows.map((session) => session.id),
          ),
        )
        .orderBy(asc(facts.ordinal))
      const bySession = new Map(sessions.rows.map((session) => [session.id, [] as typeof rows]))
      for (const row of rows) bySession.get(row.turn.sessionId)?.push(row)
      const tasks = await tasksOfRows(
        core,
        scoped,
        rows.map((row) => row.turn.projectId),
      )
      const preferences = await readAgentPricingPreferences(core.prefs, context.userId)
      const records = [...bySession].flatMap(([sessionId, sessionRows]) => {
        const first = sessionRows[0]
        if (!first) return []
        const turns = sessionRows.map((row) => row.turn)
        const sum = (pick: (turn: Turn) => number) => turns.reduce((total, turn) => total + pick(turn), 0)
        const max = (pick: (turn: Turn) => number) => Math.max(...turns.map(pick))
        const costs = turns.flatMap((turn) => turnCost(turn, preferences).costUsd ?? [])
        const peaks = turns.flatMap((turn) => contextPeak(turn) ?? [])
        const failureRun = worst(turns, (turn) => turn.longestFailureRun)
        const repeats = worst(turns, (turn) => turn.repeatedCalls)
        const task = tasks.get(first.turn.taskId)
        return [
          {
            recordId: sessionId,
            data: {
              sessionId,
              title: first.title || first.turn.provider,
              provider: first.turn.provider,
              kind: first.kind,
              archived: first.archivedAt !== null,
              taskId: first.turn.taskId,
              taskTitle: task?.title ?? null,
              taskStatus: task?.status ?? null,
              projectId: first.turn.projectId ?? task?.projectId ?? null,
              projectName: task?.projectName ?? null,
              changeRequests: 0,
              turns: turns.length,
              failedTurns: turns.filter((turn) => turn.status === 'failed' || turn.status === 'interrupted').length,
              firstStartedAt: Math.min(...turns.map((turn) => turn.startedAt)),
              lastCompletedAt: max((turn) => turn.completedAt),
              activeMs: sum((turn) => turn.activeMs),
              approvalWaitMs: sum((turn) => turn.approvalWaitMs),
              toolCalls: sum((turn) => turn.toolCalls),
              toolFailures: sum((turn) => turn.toolFailures),
              filesChanged: sum((turn) => turn.filesChanged),
              filesRewritten: sum((turn) => turn.filesRewritten),
              subagents: sum((turn) => turn.subagents),
              inputTokens: sum((turn) => turn.inputTokens),
              outputTokens: sum((turn) => turn.outputTokens),
              cacheReadTokens: sum((turn) => turn.cacheReadTokens),
              cacheWriteTokens: sum((turn) => turn.cacheWriteTokens),
              costUsd: costs.length ? costs.reduce((total, cost) => total + cost, 0) : null,
              longestFailureRun: failureRun?.longestFailureRun ?? 0,
              longestFailureRunTurn: failureRun?.ordinal ?? null,
              longestFailureRunSeq: failureRun?.failureRunSeq ?? null,
              repeatedCalls: repeats?.repeatedCalls ?? 0,
              repeatedCallsTurn: repeats?.ordinal ?? null,
              repeatedCallsSeq: repeats?.repeatRunSeq ?? null,
              maxFilesRewritten: max((turn) => turn.filesRewritten),
              contextPeak: peaks.length ? Math.max(...peaks) : null,
            },
            taskId: first.turn.taskId,
            action: { verb: 'openPane' as const, pane: AGENT_PANE_ID },
            target: { kind: 'agents.session', item: sessionId },
          },
        ]
      })
      const page = pageDataRecords(
        input,
        { records, truncated: sessions.truncated },
        { timePointer: '/lastCompletedAt', readOrder: true },
      )
      // One read per task on the page, not per task in the read.
      const changeRequests = new Map<string, { sessionId?: string }[]>()
      for (const { data } of page.records)
        if (!changeRequests.has(data.taskId))
          changeRequests.set(data.taskId, await core.tasks.changeRequests(data.taskId))
      return {
        ...page,
        records: page.records.map((record) => ({
          ...record,
          data: {
            ...record.data,
            changeRequests:
              changeRequests.get(record.data.taskId)?.filter((request) => request.sessionId === record.recordId)
                .length ?? 0,
          },
        })),
      }
    },
  })
}
