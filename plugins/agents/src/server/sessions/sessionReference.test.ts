import { expect, it } from 'vitest'
import type { AgentSessionSnapshot } from '../../contract/wire.ts'
import { renderSessionConversation, sessionReferenceContext } from './sessionReference'

const snapshot = (events: AgentSessionSnapshot['events']): AgentSessionSnapshot => ({
  session: { id: 'source', title: 'Investigation', lastEventSeq: events.length } as AgentSessionSnapshot['session'],
  events,
  turns: [],
  requests: [],
})
const message = (text: string) => ({ event: { type: 'assistant_message', text } }) as AgentSessionSnapshot['events'][number]

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
