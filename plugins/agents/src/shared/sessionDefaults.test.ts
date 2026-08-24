import { describe, expect, it } from 'vitest'
import type { AgentConfigOption } from '@acorn/protocol/managedAgents.ts'
import {
  defaultAgentSessionDefaults,
  effectiveAgentDefaults,
  optionsWithDefaults,
  parseAgentSessionDefaults,
  rememberAgentDefaults,
  validateAgentSessionDefaults,
} from './sessionDefaults'

const option = (id: string, current: string | null, values: string[]): AgentConfigOption => ({
  id,
  label: id,
  category: 'other',
  currentValue: current,
  values: values.map((value) => ({ value, label: value })),
})

describe('optionsWithDefaults', () => {
  it('applies a stored value the provider still advertises', () => {
    const options = [option('model', 'gpt-5.1', ['gpt-5.1', 'gpt-5.1-max'])]
    expect(optionsWithDefaults(options, { model: 'gpt-5.1-max' })[0]?.currentValue).toBe('gpt-5.1-max')
  })

  it('drops a value the provider no longer offers, so a retired model cannot wedge every start', () => {
    const options = [option('model', 'gpt-5.1', ['gpt-5.1'])]
    expect(optionsWithDefaults(options, { model: 'gpt-4' })).toBe(options)
  })

  it('returns the same array when nothing applies', () => {
    const options = [option('model', 'gpt-5.1', ['gpt-5.1'])]
    expect(optionsWithDefaults(options, { model: 'gpt-5.1' })).toBe(options)
    expect(optionsWithDefaults(options, {})).toBe(options)
    expect(optionsWithDefaults(options, { reasoning: 'high' })).toBe(options)
  })
})

describe('stored defaults', () => {
  it('reads the last values while following, and the pinned ones otherwise', () => {
    const record = {
      followLastSession: true,
      pinned: { codex: { model: 'pinned' } },
      last: { codex: { model: 'last' } },
    }
    expect(effectiveAgentDefaults(record, 'codex')).toEqual({ model: 'last' })
    expect(effectiveAgentDefaults({ ...record, followLastSession: false }, 'codex')).toEqual({ model: 'pinned' })
    expect(effectiveAgentDefaults(record, 'claude-code')).toEqual({})
  })

  it('merges a remembered change into the provider it came from', () => {
    const record = rememberAgentDefaults(
      { followLastSession: true, pinned: {}, last: { codex: { model: 'a', reasoning: 'low' } } },
      'codex',
      { reasoning: 'high' },
    )
    expect(record.last).toEqual({ codex: { model: 'a', reasoning: 'high' } })
  })

  it('falls back to the built-in record when the stored row is unusable', () => {
    expect(parseAgentSessionDefaults(null)).toEqual(defaultAgentSessionDefaults())
    expect(parseAgentSessionDefaults('{')).toEqual(defaultAgentSessionDefaults())
    expect(parseAgentSessionDefaults('{"pinned":{"codex":{"model":7}}}')).toEqual(defaultAgentSessionDefaults())
  })

  it('fills the fields a write left out', () => {
    expect(parseAgentSessionDefaults('{"followLastSession":false}'))
      .toEqual({ followLastSession: false, pinned: {}, last: {} })
  })

  it('refuses a value that is not a string, and an over-long id', () => {
    expect(validateAgentSessionDefaults({ pinned: { codex: { model: 7 } } }).ok).toBe(false)
    expect(validateAgentSessionDefaults({ pinned: { codex: { ['x'.repeat(201)]: 'a' } } }).ok).toBe(false)
    expect(validateAgentSessionDefaults({ followLastSession: 'yes' }).ok).toBe(false)
    expect(validateAgentSessionDefaults([]).ok).toBe(false)
  })

  it('drops an empty choice rather than storing it as a value', () => {
    const result = validateAgentSessionDefaults({ pinned: { codex: { model: '' } } })
    expect(result.ok && result.value.pinned).toEqual({})
  })
})
