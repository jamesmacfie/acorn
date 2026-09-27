import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import type { AgentTurn } from '../../contract/wire.ts'

vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: undefined }) }))

vi.mock('../sessions/managedClient', () => ({
  managedAgentApi: {
    attachment: async (id: string) => ({
      id, taskId: 'task', filename: id === 'image' ? 'screenshot.png' : 'notes.pdf',
      mediaType: id === 'image' ? 'image/png' : 'application/pdf', byteSize: 2048, createdAt: 0,
    }),
    attachmentContent: async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]), type: 'image/png', filename: 'screenshot.png',
    }),
    attachmentPreview: async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]), type: 'image/png', filename: 'screenshot.png',
    }),
  },
}))

const { default: QueuedAgentTurns } = await import('./QueuedAgentTurns')

const turn = (input: AgentTurn['input']): AgentTurn => ({
  id: 'turn', sessionId: 'session', ordinal: 0, source: 'interactive', status: 'queued', input,
  effectivePolicy: {}, providerTurnRef: null, stopReason: null, usage: null, error: null,
  attempt: 0, createdAt: 0, startedAt: null, completedAt: null,
})

const mount = (queued: AgentTurn) => {
  const host = document.createElement('div')
  document.body.append(host)
  const unmount = render(() => (
    <QueuedAgentTurns
      sessionId="session"
      runtimeState="working"
      turns={[queued]}
      onChanged={() => {}}
      onError={() => {}}
    />
  ), host)
  const dispose = () => { unmount(); host.remove() }
  return { host, dispose }
}

it('shows image and file attachments beside a queued prompt, including while editing', async () => {
  const { host, dispose } = mount(turn([
    { type: 'text', text: 'Please check these' },
    { type: 'image', attachmentId: 'image', alt: 'screenshot.png' },
    { type: 'attachment', attachmentId: 'file' },
  ]))
  try {
    await vi.waitFor(() => expect(host.textContent).toContain('screenshot.png'))
    expect(host.textContent).toContain('Please check these')
    expect(host.textContent).toContain('notes.pdf')
    expect(host.querySelectorAll('.ui-card[data-fit]')).toHaveLength(2)
    await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/))

    host.querySelector<HTMLButtonElement>('[aria-label="Edit queued prompt"]')!.click()
    expect(host.querySelector('textarea')?.value).toBe('Please check these')
    expect(host.textContent).toContain('screenshot.png')
    expect(host.textContent).toContain('notes.pdf')
  } finally { dispose() }
})

it('shows an attachment-only follow-up as its file tile', async () => {
  const { host, dispose } = mount(turn([{ type: 'attachment', attachmentId: 'file' }]))
  try {
    await vi.waitFor(() => expect(host.textContent).toContain('notes.pdf'))
    expect(host.textContent).not.toContain('1 attached input item')
  } finally { dispose() }
})
