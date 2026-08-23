import { describe, expect, it } from 'vitest'
import type { AgentEventRecord } from '@acorn/protocol/managedAgents.ts'
import { buildConversationItems } from './conversationItems'

const event = (seq: number, value: AgentEventRecord['event'], turnId: string | null = 'turn'): AgentEventRecord => ({
  id: String(seq),
  sessionId: 'session',
  turnId,
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

  it('folds a tool call\u2019s updates into one card and keeps the last reported status', () => {
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'bash-1', title: 'Bash', kind: 'execute', status: 'pending' } }),
      event(2, { type: 'assistant_message', text: 'running it', messageId: 'a' }),
      event(3, { type: 'tool', tool: { id: 'bash-1', title: '', status: 'completed', output: 'done\n' } }),
      // Output with no status: ACP only sends a status when it changes, so this must not reopen the run.
      event(4, { type: 'tool', tool: { id: 'bash-1', title: '', output: 'done\ntrailing' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['tool', 'assistant_message'])
    const [card] = items
    expect(card.event.type === 'tool' && card.event.tool).toEqual({
      id: 'bash-1',
      parentId: undefined,
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      input: undefined,
      output: 'done\ntrailing',
      paths: undefined,
    })
    expect(card.lastSeq).toBe(4)
  })

  it('folds a turn\u2019s usage updates into one line, including a trailing one with no turn', () => {
    const items = buildConversationItems([
      event(1, { type: 'usage', usage: { contextUsed: 94_358, contextSize: 1_000_000 } }),
      event(2, { type: 'usage', usage: { cost: { amount: 2.8301, currency: 'USD' } } }, null),
    ])
    expect(items.length).toBe(1)
    const [line] = items
    expect(line.event.type === 'usage' && line.event.usage).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      cachedInputTokens: undefined,
      contextUsed: 94_358,
      contextSize: 1_000_000,
      cost: { amount: 2.8301, currency: 'USD' },
    })
  })

  it('starts a new usage line for a new turn', () => {
    const items = buildConversationItems([
      event(1, { type: 'usage', usage: { contextUsed: 10 } }, 'turn-1'),
      event(2, { type: 'usage', usage: { contextUsed: 20 } }, 'turn-2'),
    ])
    expect(items.map((item) => item.event.type === 'usage' ? item.event.usage.contextUsed : null)).toEqual([10, 20])
  })

  it('nests a subagent\u2019s run inside its own card', () => {
    const items = buildConversationItems([
      event(1, { type: 'assistant_message', text: 'delegating', messageId: 'a' }),
      event(2, { type: 'subagent', subagent: { id: 'sub-1', title: 'Read alpha', status: 'running' } }),
      // The spawning call belongs to the subagent it starts, so the prompt and the report read as the
      // subagent's own rather than as a tool the parent ran.
      event(3, { type: 'tool', tool: { id: 'sub-1', title: 'Read alpha', input: 'go', subagentId: 'sub-1' } }),
      event(4, { type: 'tool', tool: { id: 'grep-1', title: 'Grep', status: 'pending', subagentId: 'sub-1' } }),
      event(5, { type: 'tool', tool: { id: 'own-1', title: 'Bash', status: 'pending' } }),
      event(6, { type: 'subagent', subagent: { id: 'sub-1', status: 'completed', model: 'opus' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['assistant_message', 'subagent', 'tool'])
    const [, card] = items
    expect(card.event.type === 'subagent' && card.event.subagent)
      .toMatchObject({ id: 'sub-1', title: 'Read alpha', status: 'completed', model: 'opus' })
    expect(card.children?.map((child) => child.event.type === 'tool' ? child.event.tool.id : null))
      .toEqual(['sub-1', 'grep-1'])
    expect(card.lastSeq).toBe(6)
  })

  it('folds a subagent\u2019s own tool call without touching the parent\u2019s call of the same id', () => {
    // Per-stream fold keys. One shared map would have let a subagent's update land on the parent's card.
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'shared', title: 'Parent bash', status: 'pending' } }),
      event(2, { type: 'subagent', subagent: { id: 'sub-1', title: 'Worker' } }),
      event(3, { type: 'tool', tool: { id: 'shared', title: 'Child bash', status: 'completed', subagentId: 'sub-1' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['tool', 'subagent'])
    expect(items[0].event.type === 'tool' && items[0].event.tool)
      .toMatchObject({ title: 'Parent bash', status: 'pending' })
    expect(items[1].children?.[0].event.type === 'tool' && items[1].children?.[0].event)
      .toMatchObject({ tool: { title: 'Child bash', status: 'completed' } })
  })

  it('appends a subagent\u2019s prose inside its card, not after the parent\u2019s', () => {
    const items = buildConversationItems([
      event(1, { type: 'assistant_message', text: 'parent says', messageId: 'p' }),
      event(2, { type: 'subagent', subagent: { id: 'sub-1', title: 'Worker' } }),
      event(3, { type: 'assistant_message', text: 'Te', messageId: 'c', append: true, subagentId: 'sub-1' }),
      event(4, { type: 'assistant_message', text: 'al', messageId: 'c', append: true, subagentId: 'sub-1' }),
    ])
    expect(items[0].event.type === 'assistant_message' && items[0].event.text).toBe('parent says')
    expect(items[1].children?.length).toBe(1)
    expect(items[1].children?.[0].event.type === 'assistant_message' && items[1].children?.[0].event.text).toBe('Teal')
  })

  it('keeps an orphan visible at the top level', () => {
    // A truncated replay can start mid-stream, with a subagent's tool call arriving before any card to
    // hang it on. Dropping it would silently lose work the agent really did.
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'grep-1', title: 'Grep', subagentId: 'missing' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['tool'])
  })

  it('appends tool output deltas', () => {
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'cmd', title: 'Command', status: 'running', output: 'one' } }),
      event(2, { type: 'tool', tool: { id: 'cmd', title: '', output: '-two', outputAppend: true } }),
    ])
    const [card] = items
    expect(card.event.type === 'tool' && card.event.tool.output).toBe('one-two')
  })
})
