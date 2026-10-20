import { and, asc, desc, inArray, isNotNull } from 'drizzle-orm'
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
import { toolCallSourceDescription } from '../../shared/toolCallSource'
import { turnFactsPending } from '../sessions/turnFactsBackfill'
import { scopeTasks, tasksOfRows } from './scopeTasks'
import { AGENT_PANE_ID } from '../../shared/paneIdentity'

const calls = schema.agentToolCallFacts

const fields = {
  time: { pointer: '/startedAt', column: calls.startedAt },
  equals: {
    '/tool': calls.tool,
    '/status': calls.status,
    '/failed': calls.failed,
    '/inSubagent': calls.inSubagent,
    '/sessionId': calls.sessionId,
    '/turnId': calls.turnId,
    '/taskId': calls.taskId,
    '/projectId': calls.projectId,
    '/provider': calls.provider,
  },
}
const optionColumns: Record<string, typeof calls.tool | typeof calls.provider> = {
  '/tool': calls.tool,
  '/provider': calls.provider,
}

export function createToolCallSourceHandler(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
): PluginFetchHandler {
  return createDataSourceHandler({
    description: toolCallSourceDescription,
    coverageComplete: () => !turnFactsPending(db),
    failure: 'agent_tool_call_source_failed',
    options: async (input) => {
      const column = optionColumns[input.pointer]
      if (input.target !== 'field' || !column) throw new Error('unsupported_options')
      const scoped = await scopeTasks(core, input.scope)
      const search = input.search.toLowerCase()
      const values = (
        await db
          .selectDistinct({ value: column })
          .from(calls)
          .where(and(isNotNull(column), scoped ? inArray(calls.taskId, [...scoped.keys()]) : undefined))
          .orderBy(asc(column))
      ).flatMap(({ value }) => (value?.toLowerCase().includes(search) ? [value] : []))
      return {
        options: values.slice(0, input.pageSize).map((value) => ({ id: value, label: value.slice(0, 80) })),
        exhausted: values.length <= input.pageSize,
      }
    },
    query: async (input) => {
      const scoped = await scopeTasks(core, input.query.scope)
      const { time, equals } = sqlDataFilters(input.query.predicate, fields)
      const read = withinDataBudget(
        await db
          .select()
          .from(calls)
          .where(and(...time, ...equals, scoped ? inArray(calls.taskId, [...scoped.keys()]) : undefined))
          .orderBy(desc(calls.startedAt), desc(calls.turnId), desc(calls.seq))
          .limit(DATA_READ_LIMIT),
      )
      const tasks = await tasksOfRows(
        core,
        scoped,
        read.rows.map((row) => row.projectId),
      )
      const records = read.rows.map((row) => {
        const task = tasks.get(row.taskId)
        return {
          recordId: `${row.turnId}:${row.seq}`,
          data: { ...row, taskTitle: task?.title ?? null, projectName: task?.projectName ?? null },
          taskId: row.taskId,
          action: { verb: 'openPane' as const, pane: AGENT_PANE_ID },
          target: { kind: 'agents.session', item: row.sessionId },
        }
      })
      return pageDataRecords(
        input,
        { records, truncated: read.truncated },
        { timePointer: '/startedAt', readOrder: true },
      )
    },
  })
}
