import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceCatalog } from '@acorn/protocol/dataSources.ts'
import { inputBindingPath } from './outline'

// The AI author's account rule (docs/data-sources/derived-sources.md § Use one in a panel): a
// proposal may use an account only when the person chose it in the plan the turn started from, or
// when it's the person's only usable account for that provider. Anything else is a guess, so the
// model has to ask. A derived source's input bindings follow the same rule, one input at a time, and
// every required input needs a binding.

type CatalogSource = DataSourceCatalog['sources'][number]
type Account = { id: string; provider: string }

/** Every account a plan already uses: each source's own, and each input binding's. */
function chosenAccounts(plan: PanelPlan | undefined): Set<string> {
  const chosen = new Set<string>()
  for (const source of plan?.sources ?? []) {
    if (source.reference.kind !== 'inline') continue
    const scope = source.reference.content.query.scope
    if (scope.connectionId) chosen.add(scope.connectionId)
    for (const binding of Object.values(scope.inputs ?? {})) if (binding.connectionId) chosen.add(binding.connectionId)
  }
  return chosen
}

/** The candidate's account problems, each as `<pointer>: <sentence>` for the model to fix. */
export function authoringAccountProblems(candidate: PanelPlan, base: PanelPlan | undefined, catalog: readonly CatalogSource[], accounts: readonly Account[]): string[] {
  const chosen = chosenAccounts(base)
  const find = (pluginId: string, sourceId: string) => catalog.find(entry => entry.pluginId === pluginId && entry.sourceId === sourceId)
  const allowed = (provider: string, connectionId: string | undefined): boolean => {
    const eligible = accounts.filter(account => account.provider === provider)
    return !!connectionId && (chosen.has(connectionId) || (eligible.length === 1 && eligible[0]!.id === connectionId))
  }
  const problems: string[] = []
  for (const [index, source] of candidate.sources.entries()) {
    if (source.reference.kind !== 'inline') continue
    const query = source.reference.content.query
    const entry = find(query.source.pluginId, query.source.sourceId)
    if (entry?.providerId && !allowed(entry.providerId, query.scope.connectionId)) {
      problems.push(`/sources/${index}/reference: Choose one of the person's real ${entry.providerId} accounts before using it.`)
    }
    for (const [name, input] of Object.entries(entry?.inputs ?? {})) {
      const binding = query.scope.inputs?.[name]
      const [pluginId = '', sourceId = ''] = input.source.split(':')
      const provider = find(pluginId, sourceId)?.providerId
      if (!binding) {
        if (!input.optional) problems.push(`${inputBindingPath(index, name)}: Bind the required input ${name} (${input.label}) in scope.inputs.`)
      } else if (provider && !allowed(provider, binding.connectionId)) {
        problems.push(`${inputBindingPath(index, name)}: Choose one of the person's real ${provider} accounts for ${input.label} before using it.`)
      }
    }
  }
  return problems
}
