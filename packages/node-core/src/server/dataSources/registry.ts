import { dataSourceDiscoverySchema, dataSourceRegistrationSchema, type DataSourceDiscovery, type DataSourceRegistration, type DataSourceRef, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { confinePluginPath } from '../pluginHost/dispatch'
import { canonicalDataEncoding } from '@acorn/protocol/dataValues.ts'
import type { DataSourceScope } from '@acorn/protocol/dataSources.ts'

export type CoreDataSourceHandler = (request: DataSourceRequest, env: import('../bindings').Env, signal: AbortSignal) => Promise<unknown> | unknown
export type RegisteredDataSource = DataSourceRegistration & { pluginId: string; coreHandler?: CoreDataSourceHandler }
export type RegisteredDiscovery = DataSourceDiscovery & { pluginId: string }
const sources = new Map<string, RegisteredDataSource>()
const discoveries = new Map<string, RegisteredDiscovery>()
const discoveryScopes = new Map<string, Set<string>>()
const key = (pluginId: string, id: string) => `${pluginId}:${id}`

export function registerDataSource(pluginId: string, input: DataSourceRegistration): void {
  const source = dataSourceRegistrationSchema.parse(input)
  confinePluginPath(pluginId, source.handler)
  const id = key(pluginId, source.sourceId)
  const old = sources.get(id)
  if (old && old.handler !== source.handler) throw new Error('Duplicate data source')
  sources.set(id, { ...source, pluginId })
}

/** Core-owned data uses the same runtime without pretending core is a plugin route namespace. */
export function registerCoreDataSource(input: Omit<DataSourceRegistration, 'handler'>, handler: CoreDataSourceHandler): void {
  const source = dataSourceRegistrationSchema.parse({ ...input, handler: '/v1/core/data-sources/internal' })
  sources.set(key('core', source.sourceId), { ...source, pluginId: 'core', coreHandler: handler })
}

export function registerDataSourceDiscovery(pluginId: string, input: DataSourceDiscovery): void {
  const discovery = dataSourceDiscoverySchema.parse(input)
  confinePluginPath(pluginId, discovery.handler)
  const id = key(pluginId, discovery.discoveryId)
  if (discoveries.has(id)) throw new Error('Duplicate data source discovery')
  discoveries.set(id, { ...discovery, pluginId })
}

export function clearDataSources(pluginId: string): void {
  for (const [id, source] of sources) if (source.pluginId === pluginId) { sources.delete(id); discoveryScopes.delete(id) }
  for (const [id, discovery] of discoveries) if (discovery.pluginId === pluginId) discoveries.delete(id)
}
export const registeredDataSource = (ref: DataSourceRef) => sources.get(key(ref.pluginId, ref.sourceId))
export const registeredDataSources = () => [...sources.values()]
export const registeredDataSourceDiscoveries = () => [...discoveries.values()]
export const registeredDataSourceDiscovery = (pluginId: string, discoveryId: string) => discoveries.get(key(pluginId, discoveryId))

export function registerDiscoveredSource(pluginId: string, source: DataSourceRegistration, scope: DataSourceScope): void {
  const id = key(pluginId, source.sourceId)
  if (sources.has(id) && !discoveryScopes.has(id)) throw new Error('Discovery conflicts with a static source')
  registerDataSource(pluginId, source)
  const scopes = discoveryScopes.get(id) ?? new Set<string>()
  scopes.add(canonicalDataEncoding(scope))
  discoveryScopes.set(id, scopes)
}
export function dataSourceAvailableInScope(source: RegisteredDataSource, scope: DataSourceScope): boolean {
  const scopes = discoveryScopes.get(key(source.pluginId, source.sourceId))
  return !scopes || scopes.has(canonicalDataEncoding(scope))
}
