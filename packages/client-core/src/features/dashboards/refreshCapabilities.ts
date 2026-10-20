import type { Cadence } from '@acorn/protocol/schedules.ts'
import { clientCapabilityId } from '../../infra/node/clientCapabilities'

// How a kept panel gets fresh rows (docs/dashboards/supplied-rows.md § Keeping it up to date). Core
// draws the panel and plugins run agents, so core declares these keys and the plugins provide them,
// because core can't import a plugin (infra/node/clientCapabilities.ts says where a key lives).

export type AgentAsk = {
  /** Starts a new agent session in a task, sends it the prompt as its first turn, and opens it. */
  ask(input: { taskId: string; title: string; prompt: string }): Promise<void>
}
export const AGENT_ASK = clientCapabilityId<AgentAsk>('agents.ask')

export type AgentPromptSchedules = {
  /** Saves and publishes a one-step agent workflow in the project, and approves a schedule that runs it
   *  at the cadence. Answers how to take all of it back. */
  schedule(input: {
    workspaceId: string
    projectId: string
    name: string
    prompt: string
    cadence: Cadence
  }): Promise<{ undo(): Promise<void> }>
}
export const AGENT_PROMPT_SCHEDULES = clientCapabilityId<AgentPromptSchedules>('workflows.agentPromptSchedules')
