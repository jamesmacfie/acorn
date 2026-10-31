import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionDefaultsQueryKey } from '../settings/sessionDefaultsClient.ts'
import InlineDiffCard from './InlineDiffCard.tsx'

const store = vi.hoisted(() => ({
  sessions: [] as unknown[],
  snapshots: {} as Record<string, unknown>,
  configOptions: [] as unknown[],
  started: [] as unknown[],
  sent: [] as string[],
}))
vi.mock('../sessions/managedStore.ts', () => ({
  managedAgentStore: {
    captureRead: () => ({ nodeId: null, check: () => {} }),
    sessionsForTask: () => store.sessions,
    snapshotFor: (id: string) => store.snapshots[id],
    hold: () => () => undefined,
    loadSnapshot: async () => undefined,
    startInlineSession: async (_taskId: string, _provider: unknown, origin: unknown) => {
      store.started.push(origin)
      return { id: 'session-2', origin, createdAt: 2, runtimeState: 'idle' }
    },
  },
}))
vi.mock('../sessions/managedClient.ts', () => ({
  managedAgentApi: {
    providers: async () => [{ id: 'codex', label: 'Codex', installed: true, configOptions: store.configOptions }],
    snapshot: async () => ({ turns: [] }),
    enqueue: async (_id: string, body: { input: { text: string }[] }) => void store.sent.push(body.input[0]!.text),
  },
}))

const disposers: (() => void)[] = []
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  store.sessions = []
  store.snapshots = {}
  store.configOptions = []
  store.started = []
  store.sent = []
  for (const surface of document.querySelectorAll('.ui-popover')) surface.remove()
})

const origin = {
  kind: 'inline-diff',
  source: 'pull-request',
  taskId: 'task-1',
  path: 'src/app.ts',
  side: 'new',
  line: 12,
  patchKey: 'patch',
  quote: 'new line',
  pull: { owner: 'acorn', repo: 'web', number: '42' },
} as const

const note = {
  props: {
    side: 'new',
    line: 12,
    tone: 'danger',
    label: 'Risk',
    author: 'Claude Code',
    from: 'review-guide',
    title: 'This may overflow.',
    body: 'Check **the cap**.',
  },
  folded: () => false,
  setFolded: () => {},
} as const

const mount = (notes?: readonly (typeof note)[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  document.body.append(host)
  disposers.push(() => {
    host.remove()
    client.clear()
  })
  disposers.push(
    render(
      () => (
        <QueryClientProvider client={client}>
          <InlineDiffCard origin={origin} loadContext={async () => 'new line'} notes={notes} />
        </QueryClientProvider>
      ),
      host,
    ),
  )
  return host
}

describe('inline diff chat', () => {
  it('moves model and per-chat permissions into the sparkle picker, with no provider choice for one harness', async () => {
    store.configOptions = [
      { id: 'model', category: 'model', values: [{ value: 'fast', label: 'Fast' }] },
      { id: 'sandbox', category: 'permission', values: [{ value: 'read-only', label: 'Read only' }] },
    ]
    const host = mount()
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Model and permissions"]')
    expect(picker).toBeTruthy()
    expect(host.querySelectorAll('select')).toHaveLength(0)

    picker!.click()
    const popover = document.querySelector('.ui-popover')!
    await vi.waitFor(() => expect(popover.querySelectorAll('select')).toHaveLength(1))
    expect(popover.textContent).toContain('Permissions')
    expect(popover.textContent).toContain('Model')
    expect(popover.querySelector('[aria-label="Agent permissions"]')).toBeTruthy()
    const model = popover.querySelectorAll<HTMLSelectElement>('select')[0]!
    model.value = 'fast'
    model.dispatchEvent(new Event('change', { bubbles: true }))
    expect(picker!.dataset.tip).toContain('Fast')
    const read = [...popover.querySelectorAll('button')].find((button) => button.textContent === 'Read only')!
    const write = [...popover.querySelectorAll('button')].find((button) => button.textContent === 'Write access')!
    expect(read.getAttribute('aria-checked')).toBe('true')
    write.click()
    expect(write.getAttribute('aria-checked')).toBe('true')
    expect(picker!.dataset.tip).toContain('write access')
  })

  it('opens with cached session defaults written before inline choices existed', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(agentSessionDefaultsQueryKey, {
      continueAfterUsageLimit: true,
      followLastSession: true,
      pinned: {},
      last: {},
    })
    const host = document.createElement('div')
    document.body.append(host)
    disposers.push(() => {
      host.remove()
      client.clear()
    })
    disposers.push(
      render(
        () => (
          <QueryClientProvider client={client}>
            <InlineDiffCard
              origin={{
                kind: 'inline-diff',
                source: 'pull-request',
                taskId: 'task-1',
                path: 'src/app.ts',
                side: 'new',
                line: 12,
                patchKey: 'patch',
                quote: 'new line',
                pull: { owner: 'acorn', repo: 'web', number: '42' },
              }}
              loadContext={async () => 'new line'}
            />
          </QueryClientProvider>
        ),
        host,
      ),
    )
    expect(host.textContent).toContain('Ask agent · src/app.ts:12')
  })

  it('draws the chat with the thread\u2019s own cards and folds down to its header', () => {
    store.sessions = [{ id: 'session-1', origin, createdAt: 1, runtimeState: 'working' }]
    const record = (seq: number, event: unknown) => ({
      id: String(seq),
      sessionId: 'session-1',
      turnId: 'turn',
      seq,
      schemaVersion: 1,
      event,
      searchText: null,
      createdAt: seq,
    })
    store.snapshots = {
      'session-1': {
        session: store.sessions[0],
        turns: [],
        events: [
          record(1, { type: 'user_message', text: 'Question about src/app.ts:12:\n\nnew line\n\nQuestion:\nWhy?' }),
          record(2, { type: 'assistant_message', text: 'Because **it matters**.', messageId: 'a' }),
          record(3, {
            type: 'tool',
            tool: { id: 'read-1', title: 'Read src/app.ts', kind: 'read', status: 'completed' },
          }),
          record(4, { type: 'request', requestId: 'ask-1', kind: 'question', title: 'Which branch?' }),
        ],
        requests: [
          {
            id: 'row-1',
            sessionId: 'session-1',
            turnId: 'turn',
            providerRequestId: 'ask-1',
            kind: 'question',
            status: 'pending',
            title: 'Which branch?',
            detail: null,
            resolution: null,
            expiresAt: null,
            createdAt: 4,
            resolvedAt: null,
            payload: {
              options: [],
              questions: [{ id: 'branch', prompt: 'Which branch?', options: [{ id: 'main', label: 'main' }] }],
            },
          },
        ],
      },
    }
    const host = mount()
    expect(host.querySelector('strong')?.textContent).toBe('it matters')
    expect(host.textContent).toContain('Why?')
    expect(host.textContent).not.toContain('Question about')
    expect(host.textContent).not.toContain('Expand activity')
    // Activity stays in Agents; the agent's question is answered here, under the state mark.
    expect(host.textContent).not.toContain('Read src/app.ts')
    expect(host.textContent).toContain('Which branch?')
    expect(host.querySelector('.ui-icon')?.getAttribute('data-spin')).toBe('')

    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
    button('Hide')!.click()
    expect(host.textContent).toContain('Ask agent · src/app.ts:12')
    expect(host.textContent).not.toContain('it matters')
    expect(host.querySelector('textarea')).toBeNull()
    button('Show')!.click()
    expect(host.textContent).toContain('it matters')
  })

  it('opens on its notes, sends them with the first question, and keeps them on the conversation', async () => {
    const host = mount([note])
    expect(host.textContent).toContain('This may overflow.')
    // The body's Markdown loads lazily.
    await vi.waitFor(() => expect(host.querySelector('.diff-note-body strong')?.textContent).toBe('the cap'))
    const box = host.querySelector('textarea')!
    expect(box.placeholder).toBe('Ask a follow-up…')
    box.value = 'Is 10 enough?'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    const send = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Send')!
    await vi.waitFor(() => expect(send.disabled).toBe(false))
    send.click()
    await vi.waitFor(() => expect(store.sent).toHaveLength(1))
    expect(store.started).toMatchObject([
      {
        notes: [
          {
            tone: 'danger',
            label: 'Risk',
            author: 'Claude Code',
            title: 'This may overflow.',
            body: 'Check **the cap**.',
          },
        ],
      },
    ])
    expect(store.sent[0]).toContain(
      "The reader didn't write it.\n\nFrom the review-guide plugin, which names Claude Code as the author:\nRisk: This may overflow.\nCheck **the cap**.\n\nnew line",
    )
    expect(store.sent[0]).toMatch(/Question:\nIs 10 enough\?$/)
  })

  it('draws the notes a conversation started with when it is drawn without any', () => {
    store.sessions = [
      { id: 'session-1', origin: { ...origin, notes: [{ title: 'Kept note.', body: 'Kept body.' }] }, createdAt: 1 },
    ]
    store.snapshots = { 'session-1': { session: store.sessions[0], turns: [], events: [], requests: [] } }
    const host = mount()
    expect(host.textContent).toContain('Kept note.')
    expect(host.textContent).toContain('Kept body.')
  })
})
