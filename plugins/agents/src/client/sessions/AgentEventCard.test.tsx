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
