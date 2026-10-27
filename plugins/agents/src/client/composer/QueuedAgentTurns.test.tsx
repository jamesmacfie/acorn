import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import type { AgentTurn } from '../../contract/wire.ts'

const labels = vi.hoisted(() => ({ singular: 'project' }))
const steerQueuedTurn = vi.hoisted(() => vi.fn())
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  createWorkspaceWords: () => () => ({ singular: labels.singular }),
}))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: { provider: 2, workspace: 3 } }) }))

vi.mock('../sessions/managedClient', () => ({
  managedAgentApi: {
    steerQueuedTurn,
    attachment: async (id: string) => ({
      id,
      taskId: 'task',
      filename: id === 'image' ? 'screenshot.png' : 'notes.pdf',
      mediaType: id === 'image' ? 'image/png' : 'application/pdf',
      byteSize: 2048,
      createdAt: 0,
    }),
    attachmentContent: async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]),
      type: 'image/png',
      filename: 'screenshot.png',
    }),
    attachmentPreview: async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]),
      type: 'image/png',
      filename: 'screenshot.png',
    }),
  },
}))

const { default: QueuedAgentTurns } = await import('./QueuedAgentTurns')

const turn = (input: AgentTurn['input']): AgentTurn => ({
  id: 'turn',
  sessionId: 'session',
  ordinal: 0,
  source: 'interactive',
  status: 'queued',
  input,
  effectivePolicy: {},
  providerTurnRef: null,
  stopReason: null,
  usage: null,
  error: null,
  attempt: 0,
  createdAt: 0,
  startedAt: null,
  completedAt: null,
})

const mount = (queued: AgentTurn, runtimeState: 'working' | 'ready' | 'failed' = 'working') => {
  const host = document.createElement('div')
  document.body.append(host)
  const unmount = render(
    () => (
      <QueuedAgentTurns
        sessionId="session"
        runtimeState={runtimeState}
        turns={[queued]}
        onChanged={() => {}}
        onError={() => {}}
      />
    ),
    host,
  )
  const dispose = () => {
    unmount()
    host.remove()
  }
  return { host, dispose }
}

it.each(['project', 'workspace'])('names a blocked queue limit per %s', (singular) => {
  labels.singular = singular
  const { host, dispose } = mount(turn([{ type: 'text', text: 'Next step' }]), 'ready')
  try {
    expect(host.textContent).toContain(`2 turns at once per provider and 3 per ${singular}.`)
  } finally {
    dispose()
  }
})

it('says a failed session holds the queue until another message is sent', () => {
  const { host, dispose } = mount(turn([{ type: 'text', text: 'Next step' }]), 'failed')
  try {
    expect(host.textContent).toContain('Send another message to try again.')
    expect(host.textContent).not.toContain('Sends when the provider is ready.')
  } finally {
    dispose()
  }
})

it('shows image and file attachments beside a queued prompt, including while editing', async () => {
  const { host, dispose } = mount(
    turn([
      { type: 'text', text: 'Please check these' },
      { type: 'image', attachmentId: 'image', alt: 'screenshot.png' },
      { type: 'attachment', attachmentId: 'file' },
    ]),
  )
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
  } finally {
    dispose()
  }
})

it('shows an attachment-only follow-up as its file tile', async () => {
  const { host, dispose } = mount(turn([{ type: 'attachment', attachmentId: 'file' }]))
  try {
    await vi.waitFor(() => expect(host.textContent).toContain('notes.pdf'))
    expect(host.textContent).not.toContain('1 attached input item')
  } finally {
    dispose()
  }
})

const steerable = (initial: AgentTurn, steerable = true) => {
  const [turns, setTurns] = createSignal([initial])
  const host = document.createElement('div')
  document.body.append(host)
  const unmount = render(
    () => (
      <QueuedAgentTurns
        sessionId="session"
        runtimeState="working"
        turns={turns()}
        steerable={steerable}
        onChanged={() => {}}
        onError={() => {}}
      />
    ),
    host,
  )
  const steerButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Steer now')
  const dispose = () => {
    unmount()
    host.remove()
  }
  return { host, steerButton, setTurns, dispose }
}

it('steers a queued message and says so when the turn ended first', async () => {
  const queued = turn([{ type: 'text', text: 'Stop and list the files' }])
  steerQueuedTurn.mockResolvedValue({ ...queued, status: 'steering' })
  const { host, steerButton, setTurns, dispose } = steerable(queued)
  try {
    steerButton()!.click()
    await vi.waitFor(() => expect(steerQueuedTurn).toHaveBeenCalledWith('session', 'turn'))
    setTurns([{ ...queued, status: 'steering' }])
    expect(host.textContent).toContain('Steering. The agent reads this after its current step.')
    expect(steerButton()).toBeUndefined()
    setTurns([queued])
    expect(host.textContent).toContain('The turn ended first, so this sends as the next turn.')
  } finally {
    dispose()
  }
})

it('offers no steering when the harness cannot, or for a turn a person did not send', () => {
  const plain = steerable(turn([{ type: 'text', text: 'Later' }]), false)
  const plugin = steerable({ ...turn([{ type: 'text', text: 'A note' }]), source: 'plugin' })
  try {
    expect(plain.steerButton()).toBeUndefined()
    expect(plugin.steerButton()).toBeUndefined()
  } finally {
    plain.dispose()
    plugin.dispose()
  }
})
