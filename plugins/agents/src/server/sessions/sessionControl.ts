import { BIND_CAPABILITY_CALLER } from '@acorn/protocol/plugin/ids.ts'
import type { AgentSessionControl } from '../../contract/sessionExecute'
import type { ManagedAgentRuntime } from './runtime'

export type ControlRuntime = Pick<ManagedAgentRuntime, 'store' | 'cancelTurn' | 'patchSession'>

/**
 * The task-checked control seam (docs/managed-agents/session-control.md). Workflows calls `cancel`
 * unbound. A loaded plugin gets a copy bound to its id by the host, which is what the transcript
 * names when it changes an option.
 */
export function createSessionControl(runtime: ControlRuntime, caller?: string): AgentSessionControl {
  const owned = async (taskId: string, sessionId: string) => {
    const session = await runtime.store.getSession(sessionId)
    if (!session || session.taskId !== taskId) throw new Error('Managed agent session not found for this task.')
    return session
  }
  const control: AgentSessionControl = {
    cancel: async (taskId, sessionId) => {
      await owned(taskId, sessionId)
      await runtime.cancelTurn(sessionId)
    },
    // Loaded on the first change, not at boot.
    setConfig: async (taskId, sessionId, optionId, value) =>
      (await import('./sessionConfig')).setSessionConfig(
        runtime,
        await owned(taskId, sessionId),
        optionId,
        value,
        caller,
      ),
  }
  return caller
    ? control
    : Object.assign(control, {
        [BIND_CAPABILITY_CALLER]: (pluginId: string) => createSessionControl(runtime, pluginId),
      })
}
