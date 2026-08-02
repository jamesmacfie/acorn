import { describe, expect, it } from 'vitest'
import type { AgentEventRecord } from '@acorn/protocol/managedAgents.ts'
import { buildConversationItems } from './conversationItems'

const event = (seq: number, value: AgentEventRecord['event']): AgentEventRecord => ({
  id: String(seq),
  sessionId: 'session',
  turnId: 'turn',
  seq,
  schemaVersion: 1,
  event: value,
  searchText: null,
  createdAt: seq,
})

describe('conversation projection', () => {
  it('coalesces only matching append deltas', () => {
    const items = buildConversationItems([
      event(1, { type: 'assistant_message', text: 'hello', messageId: 'a' }),
      event(2, { type: 'assistant_message', text: ' world', messageId: 'a', append: true }),
      event(3, { type: 'assistant_message', text: 'separate', messageId: 'b', append: true }),
    ])
    expect(items.map((item) => item.event.type === 'assistant_message' ? item.event.text : '')).toEqual([
      'hello world',
      'separate',
    ])
  })
})
