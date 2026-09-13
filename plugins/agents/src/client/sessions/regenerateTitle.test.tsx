import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import type { AgentSession, AgentSessionSnapshot } from '@acorn/protocol/managedAgents.ts'

const original = {
  id: 'regenerate-session',
  taskId: 'regenerate-task',
  providerId: 'codex',
  profileId: 'codex',
  kind: 'interactive',
  driverKind: 'jsonl',
  driverVersion: '1',
  providerSessionRef: 'provider-session',
  controller: 'acorn',
  runtimeState: 'ready',
  attention: 'none',
  statusAuthority: 'protocol',
  title: 'Prompt fallback',
  model: null,
  config: {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [],
  queuedTurns: 0,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
} as AgentSession

const regenerated = { ...original, title: 'Generated title', updatedAt: 2 }
const snapshot = {
  session: original,
  turns: [{
    id: 'turn-1',
    sessionId: original.id,
    ordinal: 0,
    source: 'interactive',
    status: 'completed',
    input: [{ type: 'text', text: 'Generate a more useful session title' }],
    effectivePolicy: {},
    createdAt: 1,
  }],
  events: [],
  requests: [],
} as unknown as AgentSessionSnapshot

const regenerateTitle = vi.fn(async () => regenerated)
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    providers: async () => [],
    sessions: async () => ({ sessions: [original], delegations: [], nextCursor: null }),
    snapshot: async () => snapshot,
    regenerateTitle,
  },
}))

const { createAgentPaneModel } = await import('./agentPaneModel')
const { managedAgentStore } = await import('./managedStore')

afterEach(() => {
  managedAgentStore.clear()
  vi.clearAllMocks()
})

describe('regenerating a session title', () => {
  it('offers the shared session action and replaces the cached title with the server result', async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const model = createAgentPaneModel({ id: original.taskId } as Task)
        void model.sessionsLoaded
          .then(() => managedAgentStore.loadSnapshot(original.id))
          .then(() => {
            const action = model.sessionActions().find((candidate) => candidate.id === 'regenerate-title')
            expect(action).toMatchObject({ label: 'Regenerate title', disabled: false })
            action?.run()
            return vi.waitFor(() => {
              expect(regenerateTitle).toHaveBeenCalledWith(original.id)
              expect(model.selected()?.title).toBe('Generated title')
            })
          })
          .then(resolve, reject)
          .finally(() => {
            dispose()
          })
      })
    })
  })
})
