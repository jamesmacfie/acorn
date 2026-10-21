import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentSessionSnapshot } from '../../contract/wire.ts'
import { FakeAgentDriver } from '../drivers/fake'
import { REFERENCE_EVENT_READ, renderSessionConversation, sessionReferenceContext } from './sessionReference'
import { AgentStore } from './store'

const snapshot = (events: AgentSessionSnapshot['events']): AgentSessionSnapshot => ({
  session: { id: 'source', title: 'Investigation', lastEventSeq: events.length } as AgentSessionSnapshot['session'],
  events,
  turns: [],
  requests: [],
})
const message = (text: string) =>
  ({ event: { type: 'assistant_message', text } }) as AgentSessionSnapshot['events'][number]

it('renders an empty session and wraps its reference as pasted content', () => {
  const context = sessionReferenceContext(snapshot([]))
  expect(context.content).toContain('<pasted_content')
  expect(context.content).toContain('(The source session has no displayable conversation events.)')
  expect(context.label).toBe('Session · Investigation')
  expect(context.deepLink).toEqual({ pane: 'agents', intent: { sessionId: 'source' } })
})

it('marks earlier events as omitted when the bounded conversation truncates', () => {
  const events = Array.from({ length: 201 }, (_, index) => message(`message ${index}`))
  const rendered = renderSessionConversation(snapshot(events))
  expect(rendered.truncated).toBe(true)
  expect(rendered.text).toContain('[Earlier conversation events were omitted.]')
  expect(rendered.text).not.toContain('message 0\n')
  expect(rendered.text).toContain('message 200')

  const long = renderSessionConversation(snapshot([message('start'), message('x'.repeat(100_001))]))
  expect(long.truncated).toBe(true)
  expect(long.text).not.toContain('start')
})

it('reads the same reference from the newest events as from the whole ledger', async () => {
  const ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
  try {
    const store = new AgentStore(ctx.storage.open(), ctx.core)
    const { id } = await store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      await new FakeAgentDriver().probe(),
    )
    for (let index = 0; index < 150; index++) {
      await store.recordEvent(id, null, { type: 'assistant_message', text: `message ${index}` })
      await store.recordEvent(id, null, { type: 'tool', tool: { id: `tool-${index}`, title: '', kind: 'read' } })
    }
    const recent = await store.recentSnapshot(id, REFERENCE_EVENT_READ)
    expect(recent.events).toHaveLength(REFERENCE_EVENT_READ)
    expect(renderSessionConversation(recent)).toEqual(renderSessionConversation(await store.exportSnapshot(id)))
    expect(renderSessionConversation(recent).truncated).toBe(true)
    await expect(store.recentSnapshot('missing', REFERENCE_EVENT_READ)).rejects.toThrow(/not found/)
  } finally {
    ctx.cleanup()
  }
})
