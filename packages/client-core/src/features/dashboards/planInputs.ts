import type { Integration } from '@acorn/protocol/api.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PlanInputs } from '@acorn/dashboards-core/outline.ts'
import type { PlanProblem, SourceFailure } from '@acorn/dashboards-core/plan.ts'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { disabledNodePlugins } from '../../infra/node/nodePlugins'
import { inputProviderLabel, inputSourceOf, sourceKey, type CatalogSource } from '../dataSources/sourceEntries'
import type { SourceFailureNames } from './sourceErrors'

// A plan holds a derived source's input bindings, not their names. These read the names from the
// source catalog and the person's accounts, for the outline's input rows, About this panel, and the
// words of a source's failure (docs/data-sources/derived-sources.md § Use one in a panel).

const accountName = (connections: readonly Integration[], id: string | undefined): string | undefined => {
  const connection = id ? connections.find(entry => entry.id === id) : undefined
  return connection && (connection.name ?? connection.label)
}

/** Each derived source's inputs, by plan source id. A saved query, or a source the catalog doesn't
 *  list, has none. */
export function planInputs(plan: PanelPlan, catalog: readonly CatalogSource[], connections: readonly Integration[]): PlanInputs {
  return Object.fromEntries(plan.sources.flatMap(source => {
    if (source.reference.kind !== 'inline') return []
    const query = source.reference.content.query
    const entry = catalog.find(candidate => sourceKey(candidate) === sourceKey(query.source))
    if (!entry?.inputs) return []
    return [[source.id, Object.entries(entry.inputs).map(([name, input]) => {
      const account = accountName(connections, query.scope.inputs?.[name]?.connectionId)
      return {
        name, label: input.label, ...(input.optional ? { optional: true } : {}),
        ...(inputSourceOf(input, catalog)?.providerId ? { provider: inputProviderLabel(input, catalog) } : {}),
        ...(account ? { account } : {}),
      }
    })]]
  }))
}

/** What a failure's sentence and fix need: the names, the plugin to open for Review or Turn it on,
 *  and the account to open for Reconnect. */
export type FailureContext = { names: SourceFailureNames; pluginId?: string; connection?: Integration }

/** The context for a run problem that carries a failure, read from the plan source its path names. */
export function failureContext(problem: PlanProblem & { failure: SourceFailure }, plan: PanelPlan, catalog: readonly CatalogSource[], connections: readonly Integration[]): FailureContext {
  const failure = problem.failure
  const planSource = plan.sources[Number(/^\/sources\/(\d+)/.exec(problem.path)?.[1] ?? -1)]
  const scope = planSource?.reference.kind === 'inline' ? planSource.reference.content.query.scope : undefined
  const pluginId = failure.source?.split(':')[0]
  const entry = failure.source ? catalog.find(candidate => sourceKey(candidate) === failure.source) : undefined
  const input = failure.input ? entry?.inputs?.[failure.input] : undefined
  const connectionId = failure.input ? scope?.inputs?.[failure.input]?.connectionId : scope?.connectionId
  const connection = connectionId ? connections.find(candidate => candidate.id === connectionId) : undefined
  return {
    names: {
      source: planSource?.label ?? entry?.name ?? 'This source',
      ...(pluginId && pluginId !== 'core' ? { plugin: pluginLabel(pluginId), pluginOff: disabledNodePlugins().includes(pluginId) } : {}),
      ...(entry?.providerId ? { provider: pluginLabel(entry.pluginId) } : {}),
      ...(input ? { input: {
        label: input.label, provider: inputProviderLabel(input, catalog), plural: inputSourceOf(input, catalog)?.plural,
        ...(connection ? { account: connection.name ?? connection.label } : {}),
      } } : {}),
    },
    ...(pluginId && pluginId !== 'core' ? { pluginId } : {}),
    ...(connection ? { connection } : {}),
  }
}
