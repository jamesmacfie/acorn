import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

/** Built once at session admission. A resume uses the persisted snapshot; later changes reach a running
 *  session as a note ahead of a turn. */
export type AgentStandingContext = {
  build(taskId: string): Promise<string | null>
  /** The index a session would get if it started now, read before each turn. `null` when the person
   *  switched live updates off. */
  current?(taskId: string): Promise<string | null>
}

export const AGENT_STANDING_CONTEXT = capabilityId<AgentStandingContext>('agents.standingContext.v1')
