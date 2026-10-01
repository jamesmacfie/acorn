// The pane's read mark while its session streams, and which session it opens first.
//
// A `.tsx` for the reason ./managedStore.test.tsx gives: the mark is an effect, and only the `hosts`
// project runs Solid's browser build, where an effect runs at all.
import { afterEach, expect, it, vi } from 'vitest'
import { createEffect, createRoot, Suspense } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { withQueryClient } from './queryClient.helper'
import type { AgentEventRecord, AgentProviderDescriptor, AgentSession, AgentWsFrame } from '../../contract/wire.ts'

let deliver: (frame: AgentWsFrame) => void = () => {}
vi.mock('./wsChannel', () => ({
  wsOnAgentFrame: (cb: (frame: AgentWsFrame) => void) => {
    deliver = cb
    return () => {}
  },
}))

const session = {
  id: 's1', taskId: 't1', title: 's1', providerId: 'claude', config: {}, createdAt: 1, updatedAt: 1,
  lastEventSeq: 4, lastReadSeq: 4, attention: 'none', controller: 'acorn', runtimeState: 'working',
  subagents: [], queuedTurns: 0, kind: 'interactive', archivedAt: null,
} as unknown as AgentSession

const sessions = vi.fn(async () => ({ sessions: [session], delegations: [], nextCursor: null }))
const patch = vi.fn(async (_id: string, body: { lastReadSeq: number }) => ({ ...session, lastEventSeq: body.lastReadSeq, ...body }))
const providers = vi.fn(async (_force?: boolean): Promise<AgentProviderDescriptor[]> => [])
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    providers: (force?: boolean) => providers(force),
    sessions: () => sessions(),
    patch: (id: string, body: { lastReadSeq: number }) => patch(id, body),
  },
}))

// The custom agents never answer, so a case that turns queries on sees them as a cold cache too, and
// nothing reaches for a node.
vi.mock('../settings/customAgentsClient', () => ({
  customAgentsOptions: () => ({ queryKey: ['agents', 'custom-agents'], queryFn: () => new Promise(() => {}) }),
}))

const { managedAgentStore } = await import('./managedStore')
const { createAgentPaneModel, sessionIsBlank } = await import('./agentPaneModel')

const event = (seq: number): AgentEventRecord => ({
  id: `e${seq}`, sessionId: 's1', turnId: 'turn', seq, schemaVersion: 1, searchText: null, createdAt: 100 + seq,
  event: { type: 'assistant_message', text: 'more' },
} as unknown as AgentEventRecord)

afterEach(() => {
  vi.useRealTimers()
  managedAgentStore.clear()
  providers.mockReset()
  providers.mockImplementation(async () => [])
})

const claude = { id: 'claude', label: 'Claude', installed: true, capabilities: [], diagnostics: [] } as unknown as AgentProviderDescriptor
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

it('marks read up to the newest event frame, which the row no longer carries', async () => {
  managedAgentStore.upsertSession(session)
  const dispose = createRoot((dispose) => {
    withQueryClient(() => createAgentPaneModel({ id: 't1' } as never, { shown: () => true }))
    return dispose
  })
  vi.useFakeTimers()
  for (let seq = 5; seq <= 9; seq++) deliver({ channel: 'agent:event', event: event(seq) })
  // The row stays as the node last sent it: rewriting it per event woke every roster reader.
  expect(managedAgentStore.sessions()[0]).toBe(session)
  await vi.advanceTimersByTimeAsync(350)
  expect(patch).toHaveBeenCalledTimes(1)
  expect(patch).toHaveBeenCalledWith('s1', { lastReadSeq: 9 })
  dispose()
})

it('opens the session the list will select, so a first visit reads one snapshot', async () => {
  // `older` was started first and has been working since; `newer` was started later and left alone.
  const older = { ...session, id: 'older', createdAt: 1, updatedAt: 50 }
  const newer = { ...session, id: 'newer', createdAt: 10, updatedAt: 20 }
  // The node lists a task's sessions most recently updated first.
  sessions.mockResolvedValueOnce({ sessions: [older, newer], delegations: [], nextCursor: null })
  // The rows are already in the store, from the roster read at launch, before the task list answers.
  managedAgentStore.upsertSession(newer)
  managedAgentStore.upsertSession(older)
  const opened: (string | undefined)[] = []
  const { model, dispose } = createRoot((dispose) => {
    const model = withQueryClient(() => createAgentPaneModel({ id: 't1' } as never, { shown: () => false }))
    createEffect(() => opened.push(model.selectedSessionId()))
    return { model, dispose }
  })
  await model.sessionsLoaded
  await Promise.resolve()
  expect(opened).toEqual(['older'])
  dispose()
})

it('archives without asking only when nothing would be lost', () => {
  const empty = { text: ' ', attachments: [], contexts: [] }
  const automatic = { type: 'context', source: 'context.task.automatic' } as never
  expect(sessionIsBlank({ turns: [] }, empty)).toBe(true)
  expect(sessionIsBlank({ turns: [] }, { ...empty, contexts: [automatic] })).toBe(true)
  expect(sessionIsBlank(undefined, empty)).toBe(false)
  expect(sessionIsBlank({ turns: [{}] as never }, empty)).toBe(false)
  expect(sessionIsBlank({ turns: [] }, { ...empty, text: 'hi' })).toBe(false)
  expect(sessionIsBlank({ turns: [] }, { ...empty, attachments: [{}] as never })).toBe(false)
  expect(sessionIsBlank({ turns: [] }, { ...empty, contexts: [{ type: 'context', source: 'context.task' }] as never })).toBe(false)
})

// The pane's list header only shows "Agents" and a count, but the model is built inside it, so any
// empty-cache read the model makes while it is built holds the header back (client-core panes.ts).
it('draws the list header while the providers are still being probed', async () => {
  providers.mockImplementation(() => new Promise(() => {}))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  function Header() {
    const model = createAgentPaneModel({ id: 't1' } as never, { shown: () => false })
    return <p>{`Agents ${model.taskSessions().length}, ${model.choices().length} choices, loading ${model.providersLoading()}`}</p>
  }
  const dispose = render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>waiting</p>}><Header /></Suspense>
    </QueryClientProvider>
  ), host)
  await settle()
  expect(host.textContent).toBe('Agents 1, 0 choices, loading true')
  dispose()
})

it('reads the providers from the cache on the next task, and refreshes them with a fresh probe', async () => {
  providers.mockImplementation(async () => [claude])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const modelFor = (taskId: string) => {
    let built!: ReturnType<typeof createAgentPaneModel>
    const dispose = render(() => (
      <QueryClientProvider client={client}>
        {(() => { built = createAgentPaneModel({ id: taskId } as never, { shown: () => false }); return null })()}
      </QueryClientProvider>
    ), document.createElement('div'))
    return { model: built, dispose }
  }

  const first = modelFor('t1')
  await settle()
  expect(first.model.choices().map((choice) => choice.provider.id)).toEqual(['claude'])
  first.dispose()

  const second = modelFor('t2')
  expect(second.model.providersLoading()).toBe(false)
  expect(second.model.choices().map((choice) => choice.provider.id)).toEqual(['claude'])
  expect(providers).toHaveBeenCalledTimes(1)
  expect(providers).toHaveBeenLastCalledWith(undefined)

  providers.mockImplementation(async () => [claude, { ...claude, id: 'codex', label: 'Codex' }])
  await second.model.refreshProviders()
  expect(providers).toHaveBeenLastCalledWith(true)
  expect(second.model.choices().map((choice) => choice.provider.id)).toEqual(['claude', 'codex'])
  second.dispose()
})
