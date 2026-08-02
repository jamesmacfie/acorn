import type { AgentConfigOption } from '@acorn/protocol/managedAgents.ts'

const sameValue = (
  left: AgentConfigOption['values'][number],
  right: AgentConfigOption['values'][number],
): boolean =>
  left.value === right.value
  && left.label === right.label
  && left.description === right.description

/**
 * Provider metadata is re-hydrated from SQLite for every session projection. Preserve the previous
 * array when its semantic content has not changed so open form controls keep their DOM identity.
 */
export const sameAgentConfigOptions = (
  left: AgentConfigOption[],
  right: AgentConfigOption[],
): boolean =>
  left.length === right.length
  && left.every((option, index) => {
    const candidate = right[index]
    return candidate != null
      && option.id === candidate.id
      && option.label === candidate.label
      && option.category === candidate.category
      && option.currentValue === candidate.currentValue
      && option.values.length === candidate.values.length
      && option.values.every((value, valueIndex) => {
        const nextValue = candidate.values[valueIndex]
        return nextValue != null && sameValue(value, nextValue)
      })
  })
