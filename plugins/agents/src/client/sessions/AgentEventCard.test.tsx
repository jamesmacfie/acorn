import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import type { AgentConversationItem } from './conversationItems'

let markdownMounts = 0
vi.mock('./ManagedAgentMarkdown', () => ({
  default: (props: { text: string }) => { markdownMounts++; return <span>{props.text}</span> },
}))

const { default: AgentEventCard } = await import('./AgentEventCard')

it('does not render a completed subagent’s history until its disclosure opens', () => {
  markdownMounts = 0
  const item: AgentConversationItem = {
    key: 'subagent', firstSeq: 1, lastSeq: 1001, turnId: null,
    event: { type: 'subagent', subagent: { id: 'child', title: 'Completed run', status: 'completed' } },
    children: Array.from({ length: 1000 }, (_, index) => ({
      key: `message-${index}`, firstSeq: index + 2, lastSeq: index + 2, turnId: null,
      event: { type: 'assistant_message', text: `Message ${index}` },
    })),
  }
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  try {
    expect(markdownMounts).toBe(0)
    expect(host.textContent).toContain('Completed run')
    const fold = host.querySelector('details')!
    fold.open = true
    fold.dispatchEvent(new Event('toggle'))
    expect(markdownMounts).toBe(1000)
    expect(host.textContent).toContain('Message 999')
    fold.open = false
    fold.dispatchEvent(new Event('toggle'))
    fold.open = true
    fold.dispatchEvent(new Event('toggle'))
    expect(markdownMounts).toBe(1000)
  } finally { dispose() }
})

// The same card in its two states. A request that is still blocking draws the control that answers it,
// in the thread and at the moment it interrupted; once it is answered the same seat holds the record,
// including the part nothing else keeps, which is what the reader did not pick.
const askedItem: AgentConversationItem = {
  key: 'ask', firstSeq: 1, lastSeq: 1, turnId: null,
  event: {
    type: 'request',
    requestId: 'ask-1',
    kind: 'question',
    title: 'Which drink do you want on a cold morning?',
    questions: [{
      id: 'drink',
      prompt: 'Drink',
      options: [{ id: 'tea', label: 'Tea' }, { id: 'coffee', label: 'Coffee' }],
    }],
  },
}

const requestRow = (status: 'pending' | 'resolved', resolution: unknown) => ({
  id: 'row', sessionId: 'session', turnId: null, providerRequestId: 'ask-1',
  kind: 'question' as const, status, title: 'Which drink do you want on a cold morning?',
  detail: null, payload: { options: [], questions: askedItem.event.type === 'request' ? askedItem.event.questions : [] },
  resolution, expiresAt: null, createdAt: 0, resolvedAt: null,
})

it('answers a blocking question in the thread, and keeps the answer in the same seat', () => {
  const host = document.createElement('div')
  const dispose = render(() => (
    <AgentEventCard item={askedItem} taskId="task" sessionId="session" request={requestRow('pending', null)} />
  ), host)
  try {
    // Blocking: the control is there to answer with.
    expect(host.querySelector('select')).not.toBeNull()
    expect(host.textContent).toContain('Submit answers')
  } finally { dispose() }

  const settled = document.createElement('div')
  const disposeSettled = render(() => (
    <AgentEventCard
      item={askedItem}
      taskId="task"
      sessionId="session"
      request={requestRow('resolved', { answers: { drink: 'Tea' } })}
    />
  ), settled)
  try {
    expect(settled.querySelector('select')).toBeNull()
    expect(settled.textContent).toContain('Tea')
    // Collapsed until asked for, and the option that was passed over is behind it.
    expect(settled.textContent).not.toContain('Coffee')
    const fold = settled.querySelector('details')!
    fold.open = true
    fold.dispatchEvent(new Event('toggle'))
    expect(settled.textContent).toContain('Coffee')
  } finally { disposeSettled() }
})
