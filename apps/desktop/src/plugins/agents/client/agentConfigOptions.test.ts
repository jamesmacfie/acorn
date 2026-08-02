import { describe, expect, it } from 'vitest'
import type { AgentConfigOption } from '@acorn/protocol/managedAgents.ts'
import { sameAgentConfigOptions } from './agentConfigOptions'

const options = (): AgentConfigOption[] => [{
  id: 'model',
  label: 'Model',
  category: 'model',
  currentValue: 'gpt-5.6-sol',
  values: [
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Frontier coding model' },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  ],
}]

describe('managed-agent configuration stability', () => {
  it('treats re-hydrated but unchanged provider options as equal', () => {
    expect(sameAgentConfigOptions(options(), options())).toBe(true)
  })

  it('invalidates the projection when selection or advertised values change', () => {
    const selected = options()
    selected[0] = { ...selected[0], currentValue: 'gpt-5.6-terra' }
    expect(sameAgentConfigOptions(options(), selected)).toBe(false)

    const advertised = options()
    advertised[0] = {
      ...advertised[0],
      values: [...advertised[0].values, { value: 'new', label: 'New model' }],
    }
    expect(sameAgentConfigOptions(options(), advertised)).toBe(false)
  })
})
