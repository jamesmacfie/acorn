import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import type { AgentConversationItem } from './conversationItems'
import type { AgentTurn } from '@acorn/protocol/managedAgents.ts'

let markdownMounts = 0
vi.mock('./ManagedAgentMarkdown', () => ({
  default: (props: { text: string }) => { markdownMounts++; return <span>{props.text}</span> },
}))

// The attachment card behind a sent turn asks the node for the row before it draws anything, so a
// card under test would otherwise reach the network. A PDF is the case that draws without bytes.
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    attachment: async (id: string) => ({
      id, taskId: 'task', filename: 'notes.pdf', mediaType: 'application/pdf', byteSize: 2048, createdAt: 0,
    }),
    attachmentContent: async () => { throw new Error('bytes are only fetched for a picture') },
  },
}))

const { default: AgentEventCard, withoutAttachmentPlaceholders } = await import('./AgentEventCard')

it('drops the attachment placeholder only when there is an attachment to draw instead', async () => {
  expect(withoutAttachmentPlaceholders('Have a look\n\n[Attachment: 8f2c]\n\nthanks'))
    .toBe('Have a look\n\nthanks')
  // Nothing that merely mentions one: the placeholder is a line of its own, written by the projection.
  expect(withoutAttachmentPlaceholders('see [Attachment: 8f2c] above')).toBe('see [Attachment: 8f2c] above')

  const item: AgentConversationItem = {
    key: 'turn', firstSeq: 1, lastSeq: 1, turnId: 'turn-1',
    event: { type: 'user_message', text: 'Have a look\n\n[Attachment: 8f2c]' },
  }
  const turn = { id: 'turn-1', input: [{ type: 'attachment', attachmentId: '8f2c' }] } as AgentTurn
  const host = document.createElement('div')
  const dispose = render(() => (
    <AgentEventCard item={item} taskId="task" sessionId="session" turn={turn} />
  ), host)
  try {
    expect(host.textContent).toContain('Have a look')
    expect(host.textContent).not.toContain('[Attachment:')
    // The row is drawn once the node has answered.
    await vi.waitFor(() => expect(host.textContent).toContain('notes.pdf'))
  } finally { dispose() }
})

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

it('closes a turn with the context window on the right of the line', () => {
  const item: AgentConversationItem = {
    key: 'done', firstSeq: 9, lastSeq: 9, turnId: 'turn-1',
    event: { type: 'turn_completed', stopReason: 'end_turn' },
    context: { used: 94_358, size: 1_000_000 },
  }
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  try {
    // One row, the reason first and the figure last, which is what `Inline spread` puts at each end.
    const row = host.querySelector('.ui-inline[data-spread]')
    expect(row?.textContent).toBe('Turn complete · end_turn94,358 / 1,000,000 context')
  } finally { dispose() }
})

it('closes a turn that reported no context with the reason alone', () => {
  const item: AgentConversationItem = {
    key: 'done', firstSeq: 9, lastSeq: 9, turnId: 'turn-1',
    event: { type: 'turn_completed', stopReason: 'refusal' },
  }
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  try {
    expect(host.textContent).toBe('Turn complete · refusal')
  } finally { dispose() }
})
