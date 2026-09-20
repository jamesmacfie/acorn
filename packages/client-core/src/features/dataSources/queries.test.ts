import { expect, it } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import type { DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { dataSourceQueryKey, invalidateDataSources } from './queries'

const request: DataSourceRequest = { operation: 'describe', source: { pluginId: 'provider', sourceId: 'records' }, scope: { workspaceId: 'workspace', connectionId: 'account', parameters: { project: 'one' } } }
it('separates Node, source, connection, resolved scope, query digest and revision', () => {
  const key = dataSourceQueryKey('node-a', request, '1')
  expect(dataSourceQueryKey('node-b', request, '1')).not.toEqual(key)
  expect(dataSourceQueryKey('node-a', request, '2')).not.toEqual(key)
  expect(dataSourceQueryKey('node-a', { ...request, scope: { ...request.scope, parameters: { project: 'two' } } }, '1')).not.toEqual(key)
  expect(dataSourceQueryKey('node-a', { ...request, scope: { ...request.scope, connectionId: 'other' } }, '1')).not.toEqual(key)
})
it('invalidates one connection on one Node without discarding cached data', async () => {
  const client = new QueryClient()
  const a = dataSourceQueryKey('a', request)
  const b = dataSourceQueryKey('b', request)
  client.setQueryData(a, { revision: '1' })
  client.setQueryData(b, { revision: '1' })
  await invalidateDataSources(client, 'a', { connectionId: 'account' })
  expect(client.getQueryState(a)?.isInvalidated).toBe(true)
  expect(client.getQueryState(b)?.isInvalidated).toBe(false)
  expect(client.getQueryData(a)).toEqual({ revision: '1' })
  client.clear()
})
