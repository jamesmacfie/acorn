import type { QueryPublicationPlan } from '@acorn/protocol/queryPublication.ts'
import type { QueryConsumer, QueryScope } from '@acorn/protocol/dataQueries.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowDef } from './workflowContracts'

export type WorkflowPublicationSelection = {
  id: string
  revision: number
  workflows?: Record<string, number>
  queries?: Record<string, { revision: number; parameters?: Record<string, DataValue> }>
  validation?: Record<string, { inputs?: Record<string, DataValue>; steps?: Record<string, DataValue> }>
}
export type WorkflowPublicationWrite = {
  kind: 'workflow'
  id: string
  name: string
  draftRevision: number
  basePublishedRevision: number | null
  revision: number
  scope: QueryScope
  def: WorkflowDef
  digest: string
  previousQueryIds?: string[]
} | { kind: 'query'; id: string; name: string; scope: QueryScope; plan: QueryPublicationPlan }
export type WorkflowPublication = {
  id: string
  workspaceId: string
  rootId: string
  state: 'prepared' | 'publishing' | 'complete' | 'needs-reconciliation'
  writes: WorkflowPublicationWrite[]
  consumers: QueryConsumer[]
  reused: { kind: 'workflow' | 'query'; id: string; revision: number; scope?: QueryScope; pinned?: boolean }[]
  landed: { kind: 'workflow' | 'query'; id: string; revision: number }[]
  error: string | null
  createdAt: number
  updatedAt: number
}
