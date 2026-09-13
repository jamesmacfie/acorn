import type { AgentSessionControl } from '../../contract/sessionExecute'
import type { ManagedAgentRuntime } from './runtime'

/** Builds the task-checked cancellation seam used by workflow tree cancellation. */
export function createSessionControl(
  runtime: Pick<ManagedAgentRuntime, 'store' | 'cancelTurn'>,
): AgentSessionControl {
  return {
    cancel: async (taskId, sessionId) => {
      const session = await runtime.store.getSession(sessionId)
      if (!session || session.taskId !== taskId) throw new Error('Managed agent session not found for this task.')
      await runtime.cancelTurn(sessionId)
    },
  }
}
