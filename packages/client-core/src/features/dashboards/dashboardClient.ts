import type { QueryClient } from '@tanstack/solid-query'
import type { DashboardDraft, DashboardContent, DashboardRevision, DashboardScope, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import { writeJson } from '../../infra/node/apiClient'

export const dashboardDraftsKey = (nodeId: string, scope: DashboardScope) =>
  ['dashboard-drafts', nodeId, scope.workspaceId, scope.projectId ?? null] as const
export const publishedDashboardPanelKey = (nodeId: string, scope: DashboardScope, id: string, revision?: number, zone?: string) =>
  ['published-dashboard-panel', nodeId, scope.workspaceId, scope.projectId ?? null, id, revision ?? null, zone ?? null] as const

/** Refetches placed panels on one Node that read the given plugin or account. A panel with no data yet
 * also refetches, because the change may be what it was waiting for. */
export function invalidatePublishedPanels(client: QueryClient, nodeId: string, filter?: { pluginId?: string; connectionId?: string }): Promise<void> {
  return client.invalidateQueries({
    predicate: query => {
      if (query.queryKey[0] !== 'published-dashboard-panel' || query.queryKey[1] !== nodeId) return false
      const diagnostics = (query.state.data as DashboardRun | undefined)?.diagnostics
      return !diagnostics || (!filter?.pluginId || diagnostics.plugins.includes(filter.pluginId))
        && (!filter?.connectionId || diagnostics.accounts.includes(filter.connectionId))
    },
  })
}

export function dashboardClient(nodeId: string, scope: DashboardScope) {
  const request = <T>(operation: string, body: object = {}, signal?: AbortSignal) => writeJson<T>(`/v1/core/dashboards/${operation}`, {
    method: 'POST', nodeId, signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, operation, scope }),
  })
  return {
    list: (signal?: AbortSignal) => request<DashboardDraft[]>('list', {}, signal),
    get: (id: string, signal?: AbortSignal) => request<DashboardDraft>('get', { id }, signal),
    create: (content: PanelPlan) => request<DashboardDraft>('create', { content }),
    save: (id: string, expectedRevision: number, content: PanelPlan) =>
      request<DashboardDraft>('save', { id, expectedRevision, content }),
    validate: (content: PanelPlan) => request<{ problems: string[] }>('validate', { content }),
    publish: (id: string, expectedRevision: number) => request<DashboardRevision>('publish', { id, expectedRevision }),
    published: (id: string, revision?: number, signal?: AbortSignal) => request<DashboardRevision>('published', { id, revision }, signal),
    run: (target: { kind: 'published'; id: string; revision?: number } | { kind: 'draft'; content: DashboardContent }, mode: 'preview' | 'execution', viewerZone?: string, signal?: AbortSignal, evaluationTime?: number) =>
      request<DashboardRun>('run', { target, mode, viewerZone, ...(evaluationTime === undefined ? {} : { evaluationTime }) }, signal),
    delete: (id: string, expectedRevision: number) => request<{ ok: true }>('delete', { id, expectedRevision }),
  }
}
