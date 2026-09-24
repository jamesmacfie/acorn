import type { QueryClient } from '@tanstack/solid-query'
import { canonicalDataEncoding, parseDataValue } from '@acorn/protocol/dataValues.ts'
import type { DataSourceCatalog, DataSourceDiscoveryPage, DataSourceDiscoveryRequest, DataSourceRequest, DataSourceResponse, DataSourceScope, DataSourceRef } from '@acorn/protocol/dataSources.ts'
import { writeJson } from '../../infra/node/apiClient'

export const dataSourcesKey = ['data-sources'] as const
export const dataSourceCatalogKey = (nodeId: string, scope: DataSourceScope) =>
  [...dataSourcesKey, nodeId, 'catalog', scope.workspaceId ?? null, scope.projectId ?? null, scope.connectionId ?? null, canonicalDataEncoding(scope.parameters)] as const
export const dataSourceScopeKey = (nodeId: string, source: DataSourceRef, scope: DataSourceScope) =>
  [...dataSourcesKey, nodeId, source.pluginId, source.sourceId, scope.connectionId ?? null, scope.workspaceId ?? null, scope.projectId ?? null, canonicalDataEncoding(scope.parameters)] as const
export const dataSourceRequestDigest = (request: DataSourceRequest) => canonicalDataEncoding(parseDataValue(request))
export function dataSourceQueryKey(nodeId: string, request: DataSourceRequest, revision?: string) {
  const source = request.operation === 'query' ? request.query.source : request.operation === 'details' ? request.ref : request.source
  const scope = request.operation === 'query' ? request.query.scope : request.scope
  return [...dataSourceScopeKey(nodeId, source, scope), request.operation, dataSourceRequestDigest(request), revision ?? null] as const
}
export function dataSourceQueryOptions<R extends DataSourceRequest>(nodeId: string, request: R, revision?: string) {
  return {
    queryKey: dataSourceQueryKey(nodeId, request, revision),
    queryFn: ({ signal }: { signal: AbortSignal }) => writeJson<DataSourceResponse<R>>(`/v1/core/data-sources/${request.operation}`, {
      method: 'POST', nodeId, signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    }),
    // Results stay attached to their full request key; consumers never display another query's rows.
    staleTime: request.operation === 'describe' ? 60_000 : 0,
  }
}
export function dataSourceCatalogOptions(nodeId: string, scope: DataSourceScope) {
  return {
    queryKey: dataSourceCatalogKey(nodeId, scope),
    queryFn: ({ signal }: { signal: AbortSignal }) => writeJson<DataSourceCatalog>('/v1/core/data-sources/list', {
      method: 'POST', nodeId, signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(scope),
    }),
    staleTime: 60_000,
  }
}
export function discoverDataSourcesOptions(nodeId: string, request: DataSourceDiscoveryRequest) {
  return {
    queryKey: [...dataSourceCatalogKey(nodeId, request.scope), 'discover', request.pluginId, request.discoveryId, request.cursor ?? null] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => writeJson<DataSourceDiscoveryPage>('/v1/core/data-sources/discover', {
      method: 'POST', nodeId, signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    }),
    staleTime: 60_000,
  }
}
export function invalidateDataSources(client: QueryClient, nodeId: string, filter?: { pluginId?: string; connectionId?: string }): Promise<void> {
  return client.invalidateQueries({
    predicate: query => query.queryKey[0] === dataSourcesKey[0] && query.queryKey[1] === nodeId
      && (!filter?.pluginId || query.queryKey[2] === filter.pluginId)
      && (!filter?.connectionId || query.queryKey[4] === filter.connectionId),
  })
}
