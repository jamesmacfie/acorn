// The pane's read mark while its session streams, and which session it opens first.
//
// A `.tsx` for the reason ./managedStore.test.tsx gives: the mark is an effect, and only the `hosts`
// project runs Solid's browser build, where an effect runs at all.
import { afterEach, expect, it, vi } from 'vitest'
import { createEffect, createRoot } from 'solid-js'
import type { AgentEventRecord, AgentSession, AgentWsFrame } from '../../contract/wire.ts'

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
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    providers: async () => [],
    sessions: () => sessions(),
    patch: (id: string, body: { lastReadSeq: number }) => patch(id, body),
  },
}))

const { managedAgentStore } = await import('./managedStore')
const { createAgentPaneModel } = await import('./agentPaneModel')

const event = (seq: number): AgentEventRecord => ({
  id: `e${seq}`, sessionId: 's1', turnId: 'turn', seq, schemaVersion: 1, searchText: null, createdAt: 100 + seq,
  event: { type: 'assistant_message', text: 'more' },
} as unknown as AgentEventRecord)

afterEach(() => {
  vi.useRealTimers()
  managedAgentStore.clear()
})

it('marks read up to the newest event frame, which the row no longer carries', async () => {
  managedAgentStore.upsertSession(session)
  const dispose = createRoot((dispose) => {
    createAgentPaneModel({ id: 't1' } as never, { shown: () => true })
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
    const model = createAgentPaneModel({ id: 't1' } as never, { shown: () => false })
    createEffect(() => opened.push(model.selectedSessionId()))
    return { model, dispose }
  })
  await model.sessionsLoaded
  await Promise.resolve()
  expect(opened).toEqual(['older'])
  dispose()
})
