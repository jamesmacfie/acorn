import { readJson, type AgentSessionStarter } from '@acorn/plugin-api/client'
import { choiceId, choiceLabel, choiceStart, newSessionChoices } from '../contract/newSessionChoices.ts'
import { customAgentsRoute, type CustomAgent } from '../shared/customAgents'
import { managedAgentApi } from './sessions/managedClient'
import { appendManagedDraft } from './sessions/managedDrafts'
import { openManagedSession } from './sessions/managedSelection'
import { managedAgentStore } from './sessions/managedStore'

/** The rows of New, read fresh from the Node. */
export async function readNewSessionChoices() {
  const [providers, agents] = await Promise.all([
    managedAgentApi.providers(),
    // A failed agents read still leaves the harnesses to pick from.
    readJson<CustomAgent[]>(customAgentsRoute).catch(() => []),
  ])
  return newSessionChoices(providers, agents)
}

// Core's AGENT_SESSION_STARTER. A choice ID is the row's key, so it still names the same row if New
// gains or loses rows between `choices()` and `start()`.
export const agentSessionStarter: AgentSessionStarter = {
  choices: async () =>
    (await readNewSessionChoices()).map((choice) => ({ id: choiceId(choice), label: choiceLabel(choice) })),
  start: async ({ taskId, title, choiceId: wanted, draft }) => {
    const choices = await readNewSessionChoices()
    const choice = wanted === undefined ? choices[0] : choices.find((row) => choiceId(row) === wanted)
    if (!choice) {
      throw new Error(
        wanted === undefined
          ? 'No agent harness on this Node is installed and signed in.'
          : "That agent isn't available any more. Pick another.",
      )
    }
    const session = await managedAgentStore.startSession(taskId, choice.provider, { ...choiceStart(choice), title })
    // Before the open, so the composer mounts with the draft. Opening also asks for the composer's focus.
    appendManagedDraft(session.id, draft)
    openManagedSession(taskId, session.id)
    return session.id
  },
}
