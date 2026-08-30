import { describe, expect, it } from 'vitest'
import { agentProfileRegistry, DEFAULT_PROFILE_ID } from './index'
import { parseStreamJson, parseStreamLine } from './streamJson'

describe('agent profiles', () => {
  it('keeps the shell fallback and default profile policy explicit', () => {
    expect(agentProfileRegistry.get('shell')).toMatchObject({ id: 'shell', kind: 'shell', command: '$SHELL' })
    expect(DEFAULT_PROFILE_ID).toBe('claude-code')
    expect(agentProfileRegistry.get('missing')).toBeUndefined()
    expect(() => agentProfileRegistry.require('missing')).toThrow("Unknown agent profile 'missing'.")
  })

  it('rejects duplicate profiles and disposes registrations', () => {
    const profile = { id: 'test-profile', label: 'Test', kind: 'agent' as const, command: 'test', backendPreference: 'tmux' as const, transport: 'pty' as const }
    const dispose = agentProfileRegistry.register(profile)
    expect(agentProfileRegistry.get('test-profile')).toBe(profile)
    expect(() => agentProfileRegistry.register(profile)).toThrow("Duplicate agent profile 'test-profile'.")
    dispose()
    expect(agentProfileRegistry.get('test-profile')).toBeUndefined()
  })

  it('parses stream-json lines and extracts the latest result and usage', () => {
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('not json')).toBeNull()
    expect(parseStreamJson([
      JSON.stringify({ type: 'assistant', result: 'intermediate' }),
      JSON.stringify({ type: 'result', result: 'done', session_id: 's1', total_cost_usd: 0.25, usage: { input_tokens: 4, output_tokens: 6, cache_read_input_tokens: 2 } }),
    ].join('\n'))).toMatchObject({
      result: 'done', sessionId: 's1', costUsd: 0.25,
      usage: { inputTokens: 4, outputTokens: 6, cachedInputTokens: 2 },
      events: [{ type: 'assistant' }, { type: 'result' }],
    })
  })
})
