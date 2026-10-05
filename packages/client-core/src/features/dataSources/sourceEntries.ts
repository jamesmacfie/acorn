import type { Integration } from '@acorn/protocol/api.ts'
import { connectionName } from '@acorn/protocol/integrations.ts'
import type { QueryContent, QueryDraft, QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceCatalog, DataSourceInput, DataSourceQuery, DataSourceRef, DataSourceScope } from '@acorn/protocol/dataSources.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { pluginLabel } from './kit.ts'

// What a person can read records from: each saved query, and each source, once per usable account
// when the list names accounts. The source picker in SourceQueryEditor and the panel launcher both
// list these, so the two read the same rows in the same words.

export type CatalogSource = DataSourceCatalog['sources'][number]
/** `label` is the whole name on one line, for a flat picker and for search. A grouped list draws `name`
 *  under its `group`, such as "Linear issues" under "Linear · Runn", so neither repeats the other. */
export type SourceEntry = { id: string; label: string; group: string; name: string; icon?: string; note?: string; detail?: string }
  & ({ kind: 'saved'; query: QueryDraft } | { kind: 'source'; source: CatalogSource; connectionId?: string })

export const sourceKey = (source: DataSourceRef) => `${source.pluginId}:${source.sourceId}`

/** The accounts a source can read through: its provider's connections that aren't disabled. */
export const usableConnections = (connections: readonly Integration[], providerId: string | undefined): Integration[] =>
  providerId ? connections.filter(connection => connection.providerId === providerId && connection.status !== 'disabled') : []

/** The catalog source an input reads, when this Node lists it. */
export const inputSourceOf = (input: DataSourceInput, sources: readonly CatalogSource[]): CatalogSource | undefined =>
  sources.find(source => sourceKey(source) === input.source)

/** What an input reads from, in a person's words: its provider's plugin, such as "GitHub", or the
 *  source's own name when it needs no account. */
export const inputProviderLabel = (input: DataSourceInput, sources: readonly CatalogSource[]): string => {
  const source = inputSourceOf(input, sources)
  return source?.providerId ? pluginLabel(source.pluginId) : source?.name ?? input.label
}

/** "GitHub and Linear", from a derived source's inputs. */
const readsFrom = (source: CatalogSource, sources: readonly CatalogSource[]): string => {
  const words = [...new Set(Object.values(source.inputs ?? {}).map(input => inputProviderLabel(input, sources)))]
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? ''
}

/** A derived source's starting bindings: an input that needs no account is bound as is, and one whose
 *  provider has exactly one usable account gets that account. The rest wait for the person. */
export function defaultInputBindings(source: CatalogSource, sources: readonly CatalogSource[], connections: readonly Integration[]): DataSourceScope['inputs'] {
  if (!source.inputs) return undefined
  return Object.fromEntries(Object.entries(source.inputs).flatMap(([name, input]) => {
    const providerId = inputSourceOf(input, sources)?.providerId
    const usable = usableConnections(connections, providerId)
    return !providerId ? [[name, { parameters: {} }]] : usable.length === 1 ? [[name, { connectionId: usable[0]!.id, parameters: {} }]] : []
  }))
}

/** The required inputs a scope hasn't bound to an account yet, by name. */
export const unboundInputs = (source: CatalogSource | undefined, scope: DataSourceScope | undefined, sources: readonly CatalogSource[]): string[] =>
  Object.entries(source?.inputs ?? {}).filter(([name, input]) => {
    const binding = scope?.inputs?.[name]
    return !input.optional && (!binding || (!!inputSourceOf(input, sources)?.providerId && !binding.connectionId))
  }).map(([name]) => name)

/** Where an account's records come from: "GitHub · Work", or the account's own name when it already
 *  starts with the plugin's, as a connection named "Linear · Runn" does. */
export const accountGroup = (pluginId: string, connection: Pick<Integration, 'name' | 'label'>): string => {
  const plugin = pluginLabel(pluginId)
  const account = connectionName(connection)
  return account.toLowerCase().startsWith(plugin.toLowerCase()) ? account : `${plugin} · ${account}`
}

/** Saved queries first, then sources. With `byAccount`, a source with a provider lists once per usable
 *  account, as "Pull requests · GitHub · Work", and not at all without one. A derived source lists once,
 *  as "Release readiness · Northwind · reads GitHub and Linear", and its accounts are chosen per input. */
export function sourceEntries(input: {
  sources: readonly CatalogSource[]
  connections: readonly Integration[]
  saved: readonly QueryDraft[]
  byAccount?: boolean
}): SourceEntry[] {
  const saved = input.saved.map((query): SourceEntry => ({
    kind: 'saved', id: `saved:${query.id}`, label: query.content.name, name: query.content.name, group: 'Saved queries', note: 'Saved query', query,
  }))
  const shared = (source: CatalogSource) => ({ kind: 'source' as const, source, name: source.name, ...(source.icon ? { icon: source.icon } : {}) })
  const sources = input.sources.flatMap((source): SourceEntry[] => input.byAccount && source.providerId
    ? usableConnections(input.connections, source.providerId).map(connection => {
      const group = accountGroup(source.pluginId, connection)
      return { ...shared(source), id: `source:${sourceKey(source)}|${connection.id}`, connectionId: connection.id, group, label: `${source.name} · ${group}` }
    })
    : input.byAccount && source.inputs
      ? [{ ...shared(source), id: `source:${sourceKey(source)}`, group: pluginLabel(source.pluginId), detail: `Reads ${readsFrom(source, input.sources)}`,
        label: `${source.name} · ${pluginLabel(source.pluginId)} · reads ${readsFrom(source, input.sources)}` }]
      : [{ ...shared(source), id: `source:${sourceKey(source)}`, label: source.name, group: source.pluginId === 'core' ? 'Acorn' : pluginLabel(source.pluginId),
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
