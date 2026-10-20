import { and, asc, desc, inArray, isNotNull } from 'drizzle-orm'
import type { CoreServices, PluginDatabase, PluginFetchHandler } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import { agentUsageCost, type AgentPricingPreferences } from '../../shared/pricing'
import { turnSourceDescription } from '../../shared/turnSource'
import { readAgentPricingPreferences } from '../pricingStore'
import { turnFactsPending } from '../sessions/turnFactsBackfill'
import { READ_LIMIT, scopeTasks, sourceHandler, sourcePage, sqlFilters, tasksOfRows, withinBudget } from './sourceQuery'
import { AGENT_PANE_ID } from '../../shared/paneIdentity'

const facts = schema.agentTurnFacts
type TurnFactsRow = Omit<typeof facts.$inferSelect, 'version'>

const fields = {
  time: { pointer: '/completedAt', column: facts.completedAt },
  equals: {
    '/taskId': facts.taskId,
    '/sessionId': facts.sessionId,
    '/projectId': facts.projectId,
    '/provider': facts.provider,
    '/model': facts.model,
  },
}
const optionColumns: Record<string, typeof facts.provider | typeof facts.model> = {
  '/provider': facts.provider,
  '/model': facts.model,
}

/** A turn's cost. Its facts store 0 for tokens the harness never reported, and Claude Code reports
 *  none, so a turn with no tokens isn't estimated: it costs what the harness reported, or is unknown. */
export function turnCost(row: TurnFactsRow, preferences: AgentPricingPreferences) {
  const counted = row.inputTokens + row.outputTokens > 0
  const { costUsd, costSource } = agentUsageCost(
    {
      provider: row.provider,
      model: row.model,
      at: row.completedAt,
      inputTokens: counted ? row.inputTokens : null,
      outputTokens: counted ? row.outputTokens : null,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      reportedCostUsd: row.reportedCostUsd,
    },
    preferences,
  )
  return { costUsd, costSource }
}

/** How full the turn's context got, as a percentage of its window. */
export const contextPeak = (row: TurnFactsRow): number | null =>
  row.peakContextUsed !== null && row.contextSize ? (row.peakContextUsed / row.contextSize) * 100 : null

export function createTurnSourceHandler(
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects' | 'prefs'>,
): PluginFetchHandler {
  return sourceHandler({
    description: turnSourceDescription,
    coverageComplete: () => !turnFactsPending(db),
    failure: 'agent_turn_source_failed',
    options: async (input) => {
      const column = optionColumns[input.pointer]
      if (input.target !== 'field' || !column) throw new Error('unsupported_options')
      const scoped = await scopeTasks(core, input.scope)
      const search = input.search.toLowerCase()
      const values = (
        await db
          .selectDistinct({ value: column })
          .from(facts)
          .where(and(isNotNull(column), scoped ? inArray(facts.taskId, [...scoped.keys()]) : undefined))
          .orderBy(asc(column))
      ).flatMap(({ value }) => (value?.toLowerCase().includes(search) ? [value] : []))
      return {
        options: values.slice(0, input.pageSize).map((value) => ({ id: value, label: value.slice(0, 80) })),
        exhausted: values.length <= input.pageSize,
      }
    },
    query: async (input, context) => {
      const scoped = await scopeTasks(core, input.query.scope)
      const { time, equals } = sqlFilters(input.query.predicate, fields)
      const read = withinBudget(
        await db
          .select()
          .from(facts)
          .where(and(...time, ...equals, scoped ? inArray(facts.taskId, [...scoped.keys()]) : undefined))
          .orderBy(desc(facts.completedAt), desc(facts.turnId))
          .limit(READ_LIMIT),
      )
      const tasks = await tasksOfRows(
        core,
        scoped,
        read.rows.map((row) => row.projectId),
      )
      const preferences = await readAgentPricingPreferences(core.prefs, context.userId)
      const records = read.rows.map(({ version: _version, ...row }) => {
        const task = tasks.get(row.taskId)
        return {
          recordId: row.turnId,
          data: {
            ...row,
            ...turnCost(row, preferences),
            contextPeak: contextPeak(row),
            taskTitle: task?.title ?? null,
            projectName: task?.projectName ?? null,
          },
          taskId: row.taskId,
          action: { verb: 'openPane' as const, pane: AGENT_PANE_ID },
          target: { kind: 'agents.session', item: row.sessionId },
        }
      })
      return sourcePage(input, { records, truncated: read.truncated }, '/completedAt')
    },
  })
}
