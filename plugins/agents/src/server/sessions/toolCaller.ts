import { createLogger } from '@acorn/plugin-api/node'
import type { AgentTurnChangedEvent } from '../../contract/lifecycle'
import type { AgentSettledTurn, AgentToolCallerLookup } from '../../contract/toolCaller'
import { sessionMayDelegate } from '../delegation/policy'
import type { AgentStore } from './store'

const log = createLogger('agents:tool-caller', 'agents')
const SETTLED = new Set<string>(['completed', 'cancelled', 'failed', 'interrupted'])

/** The `agents.toolCaller` capability over this plugin's own session rows, plus the feed the lifecycle
 *  publisher calls for each turn change. */
export function createToolCallers(store: Pick<AgentStore, 'getSession' | 'activeTurn'>) {
  const listeners = new Set<(turn: AgentSettledTurn) => void>()
  const lookup: AgentToolCallerLookup = {
    resolve: async (taskId, sessionId) => {
      const session = await store.getSession(sessionId)
      if (!session || session.taskId !== taskId || session.archivedAt) return null
      const runId = session.config.workflowRunId
      return {
        taskId,
        sessionId,
        title: session.title,
        // The same rule that keeps a workflow's session from delegating.
        workflowOwned: !sessionMayDelegate(session),
        delegated: session.kind === 'delegated' || typeof session.config.delegationSpawnId === 'string',
        workflowRunId: typeof runId === 'string' ? runId : null,
        activeTurnId: (await store.activeTurn(sessionId))?.id ?? null,
      }
    },
    onTurnSettled: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    lookup,
    turnChanged: (event: AgentTurnChangedEvent): void => {
      if (!SETTLED.has(event.status)) return
      const turn = {
        taskId: event.taskId,
        sessionId: event.sessionId,
        turnId: event.turnId,
        status: event.status as AgentSettledTurn['status'],
      }
      for (const listener of listeners) {
        // A subscriber's failure is its own, and must not stop the publisher or the next subscriber.
        try {
          listener(turn)
        } catch (error) {
          log.warn(`A settled-turn subscriber failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
  }
}
