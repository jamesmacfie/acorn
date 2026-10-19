import type { DataSourceCatalog } from '@acorn/protocol/dataSources.ts'
import type { AppDatabase } from '../db/index.ts'
import { registeredDataSource } from '../dataSources/registry.ts'
import { listConnections } from '../integrations/connections.ts'

/** The catalog `data_sources_list` returns, with the account a plan names in `connectionId`: each
 *  source's provider, and the person's accounts for those providers. Ids and labels, never credentials. */
export async function withSourceAccounts(db: AppDatabase, userId: string, catalog: DataSourceCatalog) {
  const sources = catalog.sources.map((source) => {
    const providerId = registeredDataSource(source)?.providerId
    return providerId ? { ...source, providerId } : source
  })
  const providers = new Set(sources.flatMap((source) => ('providerId' in source ? [source.providerId] : [])))
  const accounts = (await listConnections(db, userId))
    .filter((connection) => providers.has(connection.provider))
    .map((connection) => ({
      id: connection.id,
      providerId: connection.provider,
      label: connection.name ?? connection.label,
      status: connection.status,
    }))
  return { ...catalog, sources, accounts }
}
