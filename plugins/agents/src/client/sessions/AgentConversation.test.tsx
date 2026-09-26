import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentSessionSnapshot } from '../../contract/wire.ts'

// Where the scroller sits in the DOM.
//
// The followed timeline is the scroller, and it sizes itself against the region that mounts the
// conversation: `.layout-region-detail` is the flex column with `min-height: 0`, and two rules in
// client-core's shell.css name `.ui-timeline-scroll` as a *direct child* of it — the measure cap and
// the padding hand-off. So the conversation has to reach the region as a fragment, and a box put
// around any of it breaks the pane's scroll with nothing failing anywhere else. That is the claim this
// file holds, because it is invisible to every other test and to tsc.

vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: [{ id: 't1', title: 'Parent task' }, { id: 't2', title: 'Child task' }] }),
  useQueryClient: () => ({ setQueryData: () => {} }),
}))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))

// The composer walks a worktree and the queue reads a concurrency route; neither is what this asks
// about, and both would need a node.
vi.mock('../composer/AgentComposer', () => ({ default: () => <textarea aria-label="Prompt" /> }))
vi.mock('../composer/QueuedAgentTurns', () => ({ default: () => null }))
vi.mock('./AgentEventCard', () => ({ default: () => null }))

const SESSION = 's1'
const session = {
  id: SESSION,
  taskId: 't1',
  title: 'A session',
  providerId: 'claude',
  config: {},
  controller: 'acorn',
  runtimeState: 'ready',
  attention: 'none',
  subagents: [],
  createdAt: 1,
  updatedAt: 1,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
} as unknown as AgentSession

// One event, because an empty session draws an EmptyState and no timeline at all.
const snapshot = {
  session,
  turns: [],
  events: [{
    id: 'e1',
    sessionId: SESSION,
    turnId: null,
    seq: 1,
    schemaVersion: 1,
    event: { type: 'assistant_message', text: 'hello', messageId: 'm1' },
    searchText: null,
    createdAt: 1,
  }],
  requests: [],
} as unknown as AgentSessionSnapshot

let listedSessions: AgentSession[] = [session]
let listedDelegations: unknown[] = []
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    snapshot: async () => snapshot,
    sessions: async () => ({ sessions: listedSessions, delegations: listedDelegations, nextCursor: null }),
  },
}))
vi.mock('./wsChannel', () => ({ wsOnAgentFrame: () => () => {} }))

const { default: AgentConversation } = await import('./AgentConversation')
const { managedAgentStore } = await import('./managedStore')

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

const hosts: Array<() => void> = []
afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  managedAgentStore.clear()
  listedSessions = [session]
  listedDelegations = []
})

const draw = () => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentConversation sessionId={SESSION} viewKeyPrefix="test" />, host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

describe('the conversation in a pane region', () => {
  it('puts the timeline scroller directly in the region it was mounted in', async () => {
    managedAgentStore.upsertSession(session)
    const host = draw()
    await managedAgentStore.loadSnapshot(SESSION)
    await Promise.resolve()

    const scroller = host.querySelector('.ui-timeline-scroll')
    expect(scroller).not.toBeNull()
    expect(scroller?.parentElement).toBe(host)
  })

  it('keeps the composer node, focus, draft and selection while a child changes', async () => {
    const child = { ...session, id: 'child', taskId: 't2', title: 'Child', kind: 'delegated' as const,
      runtimeState: 'working' as const }
    listedSessions = [session, child]
    listedDelegations = [{ sessionId: child.id, depth: 1, isolation: 'shared',
      owner: { kind: 'managed', parentSessionId: SESSION } }]
    managedAgentStore.upsertSession(session)
    const host = draw()
    await managedAgentStore.loadSnapshot(SESSION)
    await managedAgentStore.loadAll()
    const composer = host.querySelector('textarea[aria-label="Prompt"]') as HTMLTextAreaElement
    composer.value = 'Keep this draft'
    composer.focus()
    composer.setSelectionRange(5, 9)

    managedAgentStore.upsertSession({ ...child, runtimeState: 'waiting', attention: 'permission' })
    await Promise.resolve()
    expect(host.textContent).toContain('Child')
    expect(host.querySelector('textarea[aria-label="Prompt"]')).toBe(composer)
    expect(document.activeElement).toBe(composer)
    expect(composer.value).toBe('Keep this draft')
    expect([composer.selectionStart, composer.selectionEnd]).toEqual([5, 9])
  })
})
