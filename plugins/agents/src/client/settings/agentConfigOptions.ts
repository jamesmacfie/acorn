import type { AgentConfigOption, AgentProviderDescriptor } from '../../contract/wire.ts'

const sameValue = (left: AgentConfigOption['values'][number], right: AgentConfigOption['values'][number]): boolean =>
  left.value === right.value && left.label === right.label && left.description === right.description

/**
 * Provider metadata is re-hydrated from SQLite for every session projection. Preserve the previous
 * array when its semantic content has not changed so open form controls keep their DOM identity.
 */
export const sameAgentConfigOptions = (left: AgentConfigOption[], right: AgentConfigOption[]): boolean =>
  left.length === right.length &&
  left.every((option, index) => {
    const candidate = right[index]
    return (
      candidate != null &&
      option.id === candidate.id &&
      option.label === candidate.label &&
      option.category === candidate.category &&
      option.currentValue === candidate.currentValue &&
      option.values.length === candidate.values.length &&
      option.values.every((value, valueIndex) => {
        const nextValue = candidate.values[valueIndex]
        return nextValue != null && sameValue(value, nextValue)
      })
    )
  })

/**
 * Which options each provider offers. A provider only reports its models and reasoning levels once a
 * session is running, so the Node reads them off the newest of its recent sessions that advertised
 * them (`ProviderCatalogue`). A provider you have not run in that many sessions shows no pickers until
 * you run it again.
 */
export function advertisedOptionsByProvider(
  providers: readonly AgentProviderDescriptor[],
): Record<string, AgentConfigOption[]> {
  const byProvider: Record<string, AgentConfigOption[]> = {}
  for (const provider of providers) if (provider.configOptions.length) byProvider[provider.id] = provider.configOptions
  return byProvider
}
