import type { Integration } from '@acorn/protocol/api.ts'
import type { QueryContent, QueryDraft, QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescriptor, DataSourceQuery, DataSourceRef, DataSourceScope } from '@acorn/protocol/dataSources.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { pluginLabel } from './kit.ts'

// What a person can read records from: each saved query, and each source, once per usable account
// when the list names accounts. The source picker in SourceQueryEditor and the panel launcher both
// list these, so the two read the same rows in the same words.

export type CatalogSource = DataSourceDescriptor & DataSourceRef
export type SourceEntry = { id: string; label: string; note?: string }
  & ({ kind: 'saved'; query: QueryDraft } | { kind: 'source'; source: CatalogSource; connectionId?: string })

export const sourceKey = (source: DataSourceRef) => `${source.pluginId}:${source.sourceId}`

/** The accounts a source can read through: its provider's connections that aren't disabled. */
export const usableConnections = (connections: readonly Integration[], providerId: string | undefined): Integration[] =>
  providerId ? connections.filter(connection => connection.providerId === providerId && connection.status !== 'disabled') : []

/** Saved queries first, then sources. With `byAccount`, a source with a provider lists once per usable
 *  account, as "Pull requests · GitHub · Work", and not at all without one. */
export function sourceEntries(input: {
  sources: readonly CatalogSource[]
  connections: readonly Integration[]
  saved: readonly QueryDraft[]
  byAccount?: boolean
}): SourceEntry[] {
  const saved = input.saved.map((query): SourceEntry => ({ kind: 'saved', id: `saved:${query.id}`, label: query.content.name, note: 'Saved query', query }))
  const sources = input.sources.flatMap((source): SourceEntry[] => input.byAccount && source.providerId
    ? usableConnections(input.connections, source.providerId).map(connection => ({
      kind: 'source', id: `source:${sourceKey(source)}|${connection.id}`, source, connectionId: connection.id,
      label: `${source.name} · ${pluginLabel(source.pluginId)} · ${connection.name ?? connection.label}`,
    }))
    : [{ kind: 'source', id: `source:${sourceKey(source)}`, label: source.name, source,
      ...(source.pluginId === 'core' ? {} : { note: pluginLabel(source.pluginId) }) }])
  return [...saved, ...sources]
}

const emptyParameters: DataSchema = { type: 'object', properties: {}, additionalProperties: false }

/** An inline query with no conditions, named for a consumer that hasn't named it yet. */
export const blankContent = (query: DataSourceQuery): QueryContent => ({
  name: 'Inline query', parameters: emptyParameters, query, sourceParameters: {},
})

/** A new inline query that reads everything the source returns in this scope. */
export const sourceReference = (source: DataSourceRef, scope: DataSourceScope): QueryReference => ({
  kind: 'inline', bindings: {},
  content: blankContent({ source: { pluginId: source.pluginId, sourceId: source.sourceId }, scope, sort: [] }),
})
