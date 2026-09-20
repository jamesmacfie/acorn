import type { QueryConsumer, QueryDraft, QueryRevision, QueryScope } from './dataQueries'
import type { DataValue } from './dataValues'

/** Query-owned participation in an explicitly reviewed workflow publication. */
export type QueryPublicationRequest = QueryScope & ({
  action: 'inspect'
  queryId: string
  revision?: number
} | {
  action: 'prepare'
  queryId: string
  expectedRevision: number
  parameters: Record<string, DataValue>
} | {
  action: 'hold' | 'write'
  operationId: string
  plan: QueryPublicationPlan
} | {
  action: 'release' | 'abandon'
  operationId: string
})
export type QueryPublicationPlan = {
  draft: QueryDraft
  intendedRevision: number
  sourceRevision: string
}
export type QueryPublicationResult = {
  draft?: QueryDraft
  published?: QueryRevision
  plan?: QueryPublicationPlan
  consumers?: QueryConsumer[]
}
