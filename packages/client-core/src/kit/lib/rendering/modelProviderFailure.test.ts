import { describe, expect, it } from 'vitest'
import { modelProviderFailure } from './modelProviderFailure'

describe('modelProviderFailure', () => {
  it('gives the same next step for provider errors from either client transport', () => {
    expect(modelProviderFailure({ code: 'provider_needs_auth' })).toContain('Reconnect it in Settings')
    expect(modelProviderFailure(Object.assign(new Error('raw'), { code: 'provider_not_connected' }))).toContain('Pick another')
    expect(modelProviderFailure({ code: 'provider_rate_limited' })).toContain('Try again shortly')
    expect(modelProviderFailure({ code: 'provider_unavailable' }, { kind: 'harness', label: 'Claude Code' }))
      .toContain('Run it once in a terminal')
    expect(modelProviderFailure({ code: 'provider_unavailable' }, { kind: 'connection', label: 'Anthropic' }))
      .toBe('The provider did not answer. Try again shortly.')
  })

  it('leaves feature-specific errors to the caller', () => {
    expect(modelProviderFailure({ code: 'db_schema_unavailable' })).toBeUndefined()
    expect(modelProviderFailure(new Error('raw'))).toBeUndefined()
  })
})
