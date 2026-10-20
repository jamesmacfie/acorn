import type { SuppliedRows } from '@acorn/protocol/dashboards.ts'
import type { DataSourceRef, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import type { PlanSource } from './plan'

// A plan source holding rows an agent supplied (docs/dashboards/supplied-rows.md § Running). It never
// reaches a plugin: its description is its own schema and fields, and reading it returns its rows.

/** What a supplied source's records and diagnostics name as their source. No plugin registers it. */
const SUPPLIED_SOURCE: DataSourceRef = { pluginId: 'core', sourceId: 'supplied' }

/** A supplied source, described, for the validator and the runner. */
export function suppliedPlanSource(
  entry: { id: string; label: string },
  reference: SuppliedRows,
  workspaceId: string,
): PlanSource {
  return {
    instanceId: entry.id,
    label: entry.label,
    query: { source: SUPPLIED_SOURCE, scope: { workspaceId, parameters: {} }, sort: [] },
    description: {
      schema: reference.schema,
      fields: reference.fields,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      parameterFields: [],
      operations: { query: true, options: false, details: false, incremental: false, groups: [] },
      revision: String(reference.origin.readAt),
      consistency: `the rows the agent supplied, read once from ${reference.origin.says}, which never refresh`,
      coverage: { kind: 'snapshot' },
    },
  }
}

/** The rows were checked when the plan parsed, so the read is all of them, with no paging. */
export const suppliedRead = (
  reference: SuppliedRows,
  mode: DataSourceResult['mode'],
  evaluationTime: number,
): DataSourceResult => ({
  records: reference.rows.map((data, index) => ({ ref: { ...SUPPLIED_SOURCE, recordId: String(index) }, data })),
  revision: String(reference.origin.readAt),
  readTime: reference.origin.readAt,
  completeness: { kind: 'complete' },
  mode,
  evaluationTime,
})
