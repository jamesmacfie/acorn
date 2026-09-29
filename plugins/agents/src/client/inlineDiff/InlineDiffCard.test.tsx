import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionDefaultsQueryKey } from '../settings/sessionDefaultsClient.ts'
import InlineDiffCard from './InlineDiffCard.tsx'

const store = vi.hoisted(() => ({ sessions: [] as unknown[], snapshots: {} as Record<string, unknown> }))
vi.mock('../sessions/managedStore.ts', () => ({
  managedAgentStore: {
    sessionsForTask: () => store.sessions,
    snapshots: () => store.snapshots,
    hold: () => () => undefined,
    loadSnapshot: async () => undefined,
  },
}))
vi.mock('../sessions/managedClient.ts', () => ({
  managedAgentApi: {
    providers: async () => [{ id: 'codex', label: 'Codex', installed: true }],
    sessions: async () => ({ sessions: [] }),
  },
}))

const disposers: (() => void)[] = []
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  store.sessions = []
  store.snapshots = {}
})

const origin = {
  kind: 'inline-diff', source: 'pull-request', taskId: 'task-1', path: 'src/app.ts',
  side: 'new', line: 12, patchKey: 'patch', quote: 'new line',
  pull: { owner: 'acorn', repo: 'web', number: '42' },
} as const

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  document.body.append(host)
  disposers.push(() => { host.remove(); client.clear() })
  disposers.push(render(() => <QueryClientProvider client={client}>
    <InlineDiffCard origin={origin} loadContext={async () => 'new line'} />
  </QueryClientProvider>, host))
  return host
}

describe('inline diff chat', () => {
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
    disposers.push(() => { host.remove(); client.clear() })
    disposers.push(render(() => <QueryClientProvider client={client}>
      <InlineDiffCard
        origin={{
          kind: 'inline-diff', source: 'pull-request', taskId: 'task-1', path: 'src/app.ts',
          side: 'new', line: 12, patchKey: 'patch', quote: 'new line',
          pull: { owner: 'acorn', repo: 'web', number: '42' },
        }}
        loadContext={async () => 'new line'}
      />
    </QueryClientProvider>, host))
    expect(host.textContent).toContain('Ask agent · src/app.ts:12')
  })

  it('draws the chat with the thread\u2019s own cards and folds down to its header', () => {
    store.sessions = [{ id: 'session-1', origin, createdAt: 1, runtimeState: 'working' }]
    const record = (seq: number, event: unknown) => ({
      id: String(seq), sessionId: 'session-1', turnId: 'turn', seq, schemaVersion: 1, event, searchText: null, createdAt: seq,
    })
    store.snapshots = { 'session-1': { session: store.sessions[0], turns: [], events: [
      record(1, { type: 'user_message', text: 'Question about src/app.ts:12:\n\nnew line\n\nQuestion:\nWhy?' }),
      record(2, { type: 'assistant_message', text: 'Because **it matters**.', messageId: 'a' }),
      record(3, { type: 'tool', tool: { id: 'read-1', title: 'Read src/app.ts', kind: 'read', status: 'completed' } }),
      record(4, { type: 'request', requestId: 'ask-1', kind: 'question', title: 'Which branch?' }),
    ], requests: [{
      id: 'row-1', sessionId: 'session-1', turnId: 'turn', providerRequestId: 'ask-1', kind: 'question', status: 'pending',
      title: 'Which branch?', detail: null, resolution: null, expiresAt: null, createdAt: 4, resolvedAt: null,
      payload: { options: [], questions: [{ id: 'branch', prompt: 'Which branch?', options: [{ id: 'main', label: 'main' }] }] },
    }] } }
    const host = mount()
    expect(host.querySelector('strong')?.textContent).toBe('it matters')
    expect(host.textContent).toContain('Why?')
    expect(host.textContent).not.toContain('Question about')
    expect(host.textContent).not.toContain('Expand activity')
    // Activity stays in Agents; the agent's question is answered here, under the state mark.
    expect(host.textContent).not.toContain('Read src/app.ts')
    expect(host.textContent).toContain('Which branch?')
    expect(host.querySelector('.ui-icon')?.getAttribute('data-spin')).toBe('')

    const button = (label: string) => [...host.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
    button('Hide')!.click()
    expect(host.textContent).toContain('Ask agent · src/app.ts:12')
    expect(host.textContent).not.toContain('it matters')
    expect(host.querySelector('textarea')).toBeNull()
    button('Show')!.click()
    expect(host.textContent).toContain('it matters')
  })
})
