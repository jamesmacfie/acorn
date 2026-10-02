import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

/** Built once at session admission. A resume uses the persisted snapshot. */
export type AgentStandingContext = {
  build(taskId: string): Promise<string | null>
}

export const AGENT_STANDING_CONTEXT = capabilityId<AgentStandingContext>('agents.standingContext.v1')
