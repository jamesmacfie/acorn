import { describe, expect, it } from 'vitest'
import { feedFromEvents, streamJsonToAgentState, streamJsonToFeedItems } from './model'

describe('streamJsonToAgentState (the 15 §status table)', () => {
  it.each([
    [{ type: 'system', subtype: 'init' }, 'starting'],
    [{ type: 'assistant' }, 'working'],
    [{ type: 'tool_use' }, 'working'],
    [{ type: 'tool_result' }, 'working'],
    [{ type: 'permission_request' }, 'blocked'],
    [{ type: 'result' }, 'done'],
    [{ type: 'mystery' }, 'unknown'],
  ])('%j → %s', (event, expected) => {
    expect(streamJsonToAgentState(event)).toBe(expected)
  })
})

describe('feed items from stream-json', () => {
  it('maps message/thinking/tool_call/tool_result/result (+cost) per the 15 table', () => {
    const events = [
      { type: 'system', subtype: 'init', model: 'opus' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Let me check the login flow' },
            { type: 'text', text: 'Guarding the null token…' },
            { type: 'tool_use', name: 'Edit', input: { file: 'src/auth/login.ts' } },
          ],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'result', result: 'Done.', total_cost_usd: 0.04 },
    ]
    expect(feedFromEvents(events)).toEqual([
      { kind: 'status', text: 'session started (opus)' },
      { kind: 'thinking', text: 'Let me check the login flow' },
      { kind: 'message', text: 'Guarding the null token…' },
      { kind: 'tool_call', text: 'Edit {"file":"src/auth/login.ts"}' },
      { kind: 'tool_result', text: 'ok' },
      { kind: 'result', text: 'Done.', costUsd: 0.04 },
    ])
  })
  it('unknown/empty events produce nothing', () => {
    expect(streamJsonToFeedItems({ type: 'weird' })).toEqual([])
    expect(streamJsonToFeedItems({ type: 'assistant', message: { content: [] } })).toEqual([])
  })
})
