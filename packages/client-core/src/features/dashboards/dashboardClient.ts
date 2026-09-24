import type { DashboardDraft, DashboardPanelContent, DashboardRevision, DashboardScope } from '@acorn/protocol/dashboards.ts'
import { writeJson } from '../../infra/node/apiClient'

export const dashboardDraftsKey = (nodeId: string, scope: DashboardScope) =>
  ['dashboard-drafts', nodeId, scope.workspaceId, scope.projectId ?? null] as const
export const publishedDashboardPanelKey = (nodeId: string, scope: DashboardScope, id: string) =>
  ['published-dashboard-panel', nodeId, scope.workspaceId, scope.projectId ?? null, id] as const

export function dashboardClient(nodeId: string, scope: DashboardScope) {
  const request = <T>(operation: string, body: object = {}, signal?: AbortSignal) => writeJson<T>(`/v1/core/dashboards/${operation}`, {
    method: 'POST', nodeId, signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, operation, scope }),
  })
  return {
    list: (signal?: AbortSignal) => request<DashboardDraft[]>('list', {}, signal),
    get: (id: string, signal?: AbortSignal) => request<DashboardDraft>('get', { id }, signal),
    create: (content: DashboardPanelContent) => request<DashboardDraft>('create', { content }),
    save: (id: string, expectedRevision: number, content: DashboardPanelContent) =>
      request<DashboardDraft>('save', { id, expectedRevision, content }),
    validate: (content: DashboardPanelContent) => request<{ problems: string[] }>('validate', { content }),
    publish: (id: string, expectedRevision: number) => request<DashboardRevision>('publish', { id, expectedRevision }),
    published: (id: string, revision?: number, signal?: AbortSignal) => request<DashboardRevision>('published', { id, revision }, signal),
    delete: (id: string, expectedRevision: number) => request<{ ok: true }>('delete', { id, expectedRevision }),
  }
}
