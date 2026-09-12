import { describe, expect, it } from 'vitest'
import { parseStructuredResult, promptWithResultContract } from './resultContract'

describe('managed agent result contracts', () => {
  const schema = {
    type: 'object',
    properties: { verdict: { type: 'string', enum: ['pass', 'fail'] } },
    required: ['verdict'],
    additionalProperties: false,
  }

  it('adds the contract to a prompt and returns only schema-valid JSON', () => {
    expect(promptWithResultContract('Inspect.', schema)).toContain(JSON.stringify(schema))
    expect(parseStructuredResult('```json\n{"verdict":"pass"}\n```', schema)).toEqual({ verdict: 'pass' })
    expect(parseStructuredResult('```json\n{"verdict":"maybe"}\n```', schema)).toBeNull()
    expect(parseStructuredResult('```json\n{"verdict":"pass","extra":true}\n```', schema)).toBeNull()
  })
})
