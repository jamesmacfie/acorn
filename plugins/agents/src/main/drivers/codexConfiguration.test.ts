import { describe, expect, it } from 'vitest'
import { codexReasoningOptions } from './codexConfiguration'

describe('Codex configuration', () => {
  const models = {
    data: [
      {
        id: 'gpt-default',
        model: 'gpt-default',
        displayName: 'Default',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Faster' },
          { reasoningEffort: 'medium', description: 'Balanced' },
        ],
      },
      {
        id: 'gpt-deep',
        model: 'gpt-deep',
        displayName: 'Deep',
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [
          { reasoningEffort: 'high', description: 'Deep reasoning' },
          { reasoningEffort: 'xhigh', description: 'Maximum reasoning' },
        ],
      },
    ],
  }

  it('uses the active model’s advertised efforts and active thread value', () => {
    expect(codexReasoningOptions(models, 'gpt-deep', 'xhigh')).toEqual([{
      id: 'reasoning',
      label: 'Effort',
      category: 'reasoning',
      currentValue: 'xhigh',
      values: [
        { value: 'high', label: 'high', description: 'Deep reasoning' },
        { value: 'xhigh', label: 'xhigh', description: 'Maximum reasoning' },
      ],
    }])
  })

  it('falls back to the provider’s model default and omits unsupported controls', () => {
    expect(codexReasoningOptions(models, 'gpt-default', null)[0]?.currentValue).toBe('medium')
    expect(codexReasoningOptions({ data: [{ id: 'plain' }] }, 'plain', null)).toEqual([])
  })
})
