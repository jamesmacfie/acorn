import type { QueryScope, QueryContent, QueryDraft, QueryRevision, QueryConsumer, QueryReference, ResolvedQuery } from '@acorn/protocol/dataQueries.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { writeJson } from '../../infra/node/apiClient'

export const queriesKey = (nodeId: string, scope: QueryScope) => ['queries', nodeId, scope.workspaceId, scope.projectId ?? null] as const
export function queriesClient(nodeId: string, scope: QueryScope) {
  const request = <T>(operation: string, body: object = {}, signal?: AbortSignal) => writeJson<T>(`/v1/core/queries/${operation}`, {
    method: 'POST', nodeId, signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, operation, scope }),
  })
  return {
    list: (signal?: AbortSignal) => request<QueryDraft[]>('list', {}, signal),
    get: (id: string, signal?: AbortSignal) => request<QueryDraft>('get', { id }, signal),
    create: (content: QueryContent) => request<QueryDraft>('create', { content }),
    save: (id: string, expectedRevision: number, content: QueryContent) => request<QueryDraft>('save', { id, expectedRevision, content }),
    publish: (id: string, expectedRevision: number, validationParameters: Record<string, DataValue> = {}) =>
      request<{ published: QueryRevision; consumers: QueryConsumer[] }>('publish', { id, expectedRevision, validationParameters }),
    published: (id: string, revision?: number) => request<QueryRevision>('published', { id, revision }),
    consumers: (id: string) => request<QueryConsumer[]>('consumers', { id }),
    setConsumer: (id: string, consumer: QueryConsumer, remove = false) => request<{ ok: true }>('consumer', { id, consumer, remove }),
    delete: (id: string, expectedRevision: number) => request<{ ok: true }>('delete', { id, expectedRevision }),
    resolve: (reference: QueryReference, inputs: Record<string, DataValue> = {}, signal?: AbortSignal) => request<ResolvedQuery>('resolve', { reference, inputs }, signal),
  }
}
