import { describe, expect, it } from 'vitest'
import { parseCodexStreamJson } from './streamJson'

describe('Codex stream JSON', () => {
  it('takes the last agent message and maps identity and usage', () => {
    const capture = parseCodexStreamJson([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'draft' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'private' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'final title' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 9, output_tokens: 3, cached_input_tokens: 2 } }),
    ].join('\n'))
    expect(capture).toMatchObject({
      result: 'final title',
      sessionId: 'thread-1',
      usage: { inputTokens: 9, outputTokens: 3, cachedInputTokens: 2 },
    })
  })
})
