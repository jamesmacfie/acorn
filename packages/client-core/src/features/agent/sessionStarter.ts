import { clientCapabilityId } from '../../infra/node/clientCapabilities'

// How core starts an agent with a prompt for the person to finish, such as the Plugins page's Create
// plugin. Core declares the key and the agents plugin provides it, because core can't import a plugin
// (infra/node/clientCapabilities.ts says where a key lives).

/** One agent a person can start. `id` names the same row in a later `start`. */
type AgentSessionChoice = { id: string; label: string }

export type AgentSessionStarter = {
  /** The agents a person can start now, in the order the agent pane's New button lists them. */
  choices(): Promise<AgentSessionChoice[]>
  /** Starts an interactive session in the task on the chosen agent, or the first startable one, puts
   *  `draft` in its composer unsent, and opens it. Answers the session ID. */
  start(input: { taskId: string; title: string; choiceId?: string; draft: string }): Promise<string>
}
export const AGENT_SESSION_STARTER = clientCapabilityId<AgentSessionStarter>('agents.sessionStarter')
