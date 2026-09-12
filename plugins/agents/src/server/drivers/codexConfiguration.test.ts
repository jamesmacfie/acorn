import { describe, expect, it } from 'vitest'
import {
  codexCollaborationModeForTurn,
  codexCollaborationModes,
  codexReasoningOptions,
} from './codexConfiguration'

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

  it('normalizes collaboration presets into Default and Plan while retaining their masks', () => {
    const modes = codexCollaborationModes({
      data: [
        { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' },
        { name: 'Default', mode: 'default', model: null, reasoning_effort: null },
      ],
    }, 'plan')

    expect(modes.option).toEqual({
      id: 'mode',
      label: 'Mode',
      category: 'mode',
      currentValue: 'plan',
      values: [
        { value: 'default', label: 'Default' },
        { value: 'plan', label: 'Plan' },
      ],
    })
    expect(modes.presets.get('plan')).toEqual({
      name: 'Plan',
      mode: 'plan',
      model: null,
      reasoningEffort: 'medium',
    })
  })

  it('drops malformed collaboration presets without throwing', () => {
    expect(codexCollaborationModes(null, null).option).toBeNull()
    expect(codexCollaborationModes({ data: [
      null,
      { name: '', mode: 'default', model: null, reasoning_effort: null },
      { name: 'Unknown', mode: 'execute', model: null, reasoning_effort: null },
      { name: 'Plan', mode: 'plan', model: 42, reasoning_effort: 'medium' },
    ] }, 'plan').option).toBeNull()
  })

  it('expands both selections with preset fields taking precedence', () => {
    const modes = codexCollaborationModes({ data: [
      { name: 'Default', mode: 'default', model: null, reasoning_effort: null },
      { name: 'Plan', mode: 'plan', model: 'gpt-plan', reasoning_effort: 'medium' },
    ] }, 'default')

    expect(codexCollaborationModeForTurn(modes, 'default', 'gpt-selected', 'high')).toEqual({
      mode: 'default',
      settings: {
        model: 'gpt-selected',
        reasoning_effort: 'high',
        developer_instructions: null,
      },
    })
    expect(codexCollaborationModeForTurn(modes, 'plan', 'gpt-selected', 'high')).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-plan',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
  })
})
