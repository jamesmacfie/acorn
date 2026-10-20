import { and, desc, eq, inArray, sql } from 'drizzle-orm'
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
import { approvalSourceDescription } from '../../shared/approvalSource'
import { scopeTasks, tasksOfRows } from './scopeTasks'
import { AGENT_PANE_ID } from '../../shared/paneIdentity'

const requests = schema.agentRequests
const sessions = schema.agentSessions

const fields = {
  time: { pointer: '/createdAt', column: requests.createdAt },
  equals: {
    '/kind': requests.kind,
    '/sessionId': requests.sessionId,
    '/turnId': requests.turnId,
    '/taskId': sessions.taskId,
    '/provider': sessions.providerId,
  },
}

// How a request resolved, worked out in SQLite so its title, payload, and answers never reach
// JavaScript. A chosen option counts by its kind, which the request's own options name.
const chosenKind = sql`(SELECT json_extract(o.value, '$.kind') FROM json_each(${requests.payloadJson}, '$.options') o
  WHERE json_extract(o.value, '$.id') = json_extract(${requests.resolutionJson}, '$.optionId'))`
const outcome = sql<string>`CASE
  WHEN ${requests.status} = 'expired' THEN 'expired'
  WHEN ${requests.status} <> 'resolved' THEN 'pending'
  WHEN json_type(${requests.resolutionJson}, '$.blocked') IS NOT NULL THEN 'blocked'
  WHEN json_type(${requests.resolutionJson}, '$.answers') IS NOT NULL THEN 'answered'
  WHEN json_type(${requests.resolutionJson}, '$.cancelled') IS NOT NULL THEN 'cancelled'
  WHEN ${chosenKind} IN ('allow_once', 'allow_always') THEN 'allowed'
  WHEN ${chosenKind} IN ('reject_once', 'reject_always') THEN 'denied'
  ELSE 'other' END`

export function createApprovalSourceHandler(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
): PluginFetchHandler {
  return createDataSourceHandler({
    description: approvalSourceDescription,
    failure: 'agent_approval_source_failed',
    query: async (input) => {
      const scoped = await scopeTasks(core, input.query.scope)
      const { time, equals } = sqlDataFilters(input.query.predicate, fields)
      const read = withinDataBudget(
        await db
          .select({
            id: requests.id,
            kind: requests.kind,
            outcome,
            createdAt: requests.createdAt,
            resolvedAt: requests.resolvedAt,
            sessionId: requests.sessionId,
            turnId: requests.turnId,
            taskId: sessions.taskId,
            provider: sessions.providerId,
            // For a whole-Node read, which has no scope to name each task's project.
            projectId: schema.agentTurnFacts.projectId,
          })
          .from(requests)
          .innerJoin(sessions, eq(requests.sessionId, sessions.id))
          .leftJoin(schema.agentTurnFacts, eq(requests.turnId, schema.agentTurnFacts.turnId))
          .where(and(...time, ...equals, scoped ? inArray(sessions.taskId, [...scoped.keys()]) : undefined))
          .orderBy(desc(requests.createdAt), desc(requests.id))
          .limit(DATA_READ_LIMIT),
      )
      const tasks = await tasksOfRows(
        core,
        scoped,
        read.rows.map((row) => row.projectId),
      )
      const records = read.rows.map(({ id, resolvedAt, ...row }) => {
        const task = tasks.get(row.taskId)
        return {
          recordId: id,
          data: {
            ...row,
            waitMs: resolvedAt === null ? null : Math.max(0, resolvedAt - row.createdAt),
            taskTitle: task?.title ?? null,
            projectId: task?.projectId ?? row.projectId,
            projectName: task?.projectName ?? null,
          },
          taskId: row.taskId,
          action: { verb: 'openPane' as const, pane: AGENT_PANE_ID },
          target: { kind: 'agents.session', item: row.sessionId },
        }
      })
      return pageDataRecords(
        input,
        { records, truncated: read.truncated },
        { timePointer: '/createdAt', readOrder: true },
      )
    },
  })
}
