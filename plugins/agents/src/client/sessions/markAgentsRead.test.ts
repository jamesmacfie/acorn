import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../contract/wire.ts'

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  list: vi.fn(),
  patch: vi.fn(),
  upsertSession: vi.fn(),
  markAttentionSeen: vi.fn(),
  markTargetsRead: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('./managedClient', () => ({ managedAgentApi: { patch: mocks.patch, sessions: mocks.list } }))
vi.mock('./managedStore', () => ({
  managedAgentStore: {
    sessions: mocks.sessions,
    upsertSession: mocks.upsertSession,
    lastEventSeq: (session: AgentSession) => session.lastEventSeq,
  },
}))
vi.mock('./managedSelection', () => ({ agentAttentionItemId: (id: string) => `agents.sessions:${id}` }))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'node-1',
  markAttentionSeen: mocks.markAttentionSeen,
  markTargetsRead: mocks.markTargetsRead,
  toast: mocks.toast,
}))

import { acknowledgeAgentRows, clearableAgents, markAgentsRead } from './markAgentsRead'

const session = (id: string, attention: AgentSession['attention']): AgentSession =>
  ({ id, attention, lastEventSeq: 7 }) as AgentSession

// An agent blocked on the owner keeps its flag; a finished or failed one is cleared the way opening
// it would clear it, notices included.
describe('mark all agents read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessions.mockReturnValue([
      session('done', 'completed'),
      session('broke', 'error'),
      session('asking', 'permission'),
      session('quiet', 'none'),
    ])
    mocks.patch.mockImplementation(async (id: string) => session(id, 'none'))
  })

  it('offers only finished and failed agents', () => {
    expect(clearableAgents().map((s) => s.id)).toEqual(['done', 'broke'])
  })

  it('reads each to its end, retires its inbox row and marks its notices read', async () => {
    await markAgentsRead()
    expect(mocks.patch.mock.calls).toEqual([
      ['done', { lastReadSeq: 7 }, {}],
      ['broke', { lastReadSeq: 7 }, {}],
    ])
    expect(mocks.upsertSession).toHaveBeenCalledTimes(2)
    expect(mocks.markAttentionSeen.mock.calls).toEqual([
      ['node-1', 'agents.sessions:done'],
      ['node-1', 'agents.sessions:broke'],
    ])
    expect(mocks.markTargetsRead).toHaveBeenCalledWith('managed-agent', new Set(['done', 'broke']))
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('says how many it could not clear', async () => {
    mocks.patch.mockRejectedValueOnce(new Error('offline'))
    await markAgentsRead()
    expect(mocks.toast).toHaveBeenCalledWith('Could not mark 1 agent read')
  })
})

// The bell hides a row only for the window it is in, so its "Mark all read" has to reach the node, or
// the row comes back in the next window.
describe("the bell's mark all read", () => {
  const row = (id: string) => ({
    id: `agents.sessions:${id}`,
    title: id,
    severity: 'info' as const,
    at: 1,
    target: { kind: 'managed-agent', resourceId: id },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue({
      sessions: [
        { ...session('done', 'completed'), lastEventSeq: 9 },
        session('now-asking', 'permission'),
        session('not-shown', 'completed'),
      ],
    })
    mocks.patch.mockImplementation(async (id: string) => session(id, 'none'))
  })

  it("reads the rows it was shown to their end on the row's own node", async () => {
    await acknowledgeAgentRows('node-2', [row('done'), row('now-asking')])
    expect(mocks.list).toHaveBeenCalledWith({ attention: true, archived: false }, { nodeId: 'node-2' })
    // A row that turned into a block since the bell drew it keeps its flag.
    expect(mocks.patch.mock.calls).toEqual([['done', { lastReadSeq: 9 }, { nodeId: 'node-2' }]])
    // The store holds the active node's sessions only.
    expect(mocks.upsertSession).not.toHaveBeenCalled()
  })

  it("keeps the active node's store in step", async () => {
    await acknowledgeAgentRows('node-1', [row('done')])
    expect(mocks.patch.mock.calls).toEqual([['done', { lastReadSeq: 9 }, { nodeId: 'node-1' }]])
    expect(mocks.upsertSession).toHaveBeenCalledTimes(1)
  })
})
