import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionDefaultsQueryKey } from '../settings/sessionDefaultsClient.ts'
import InlineDiffCard from './InlineDiffCard.tsx'

vi.mock('../sessions/managedStore.ts', () => ({
  managedAgentStore: { sessionsForTask: () => [] },
}))
vi.mock('../sessions/managedClient.ts', () => ({
  managedAgentApi: {
    providers: async () => [{ id: 'codex', label: 'Codex', installed: true }],
    sessions: async () => ({ sessions: [] }),
  },
}))

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

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
})
