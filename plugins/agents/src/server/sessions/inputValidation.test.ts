import { describe, expect, it } from 'vitest'
import {
  assertBoundedJson,
  MAX_AGENT_CONFIG_BYTES,
  MAX_AGENT_INPUT_BYTES,
} from './inputValidation'

describe('managed-agent JSON boundaries', () => {
  it('rejects oversized manifests before persistence or provider dispatch', () => {
    expect(() => assertBoundedJson(
      'Agent turn input',
      { text: 'x'.repeat(MAX_AGENT_INPUT_BYTES) },
      MAX_AGENT_INPUT_BYTES,
    )).toThrow(/limit/)
    expect(() => assertBoundedJson(
      'Agent session configuration',
      { value: 'x'.repeat(MAX_AGENT_CONFIG_BYTES) },
      MAX_AGENT_CONFIG_BYTES,
    )).toThrow(/limit/)
  })

  it('rejects values that cannot be represented in the durable JSON domain', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => assertBoundedJson('Agent configuration', cyclic, 100)).toThrow(/serializable/)
  })
})
