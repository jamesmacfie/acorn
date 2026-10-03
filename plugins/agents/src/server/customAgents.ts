// Where custom agents live on the node (docs/managed-agents/custom-agents.md § Custom agents).
//
// Two feeders, one list. The owner's own agents are one `prefs` row per user, beside every other agent
// setting. A plugin's are held in memory for as long as the plugin is enabled, the way a contributed
// harness is, and are never written anywhere: disabling the plugin is what removes them.
import { randomUUID } from 'node:crypto'
import { BridgeError, type ManifestCustomAgent, type PrefService } from '@acorn/plugin-api/node'
import { claudeHarness } from './drivers/claudeHarness'
import {
  customAgentsPreferenceKey,
  MAX_CUSTOM_AGENTS,
  parseStoredCustomAgents,
  serializeCustomAgents,
  type CustomAgent,
  type CustomAgentInput,
} from '../shared/customAgents'

const contributed = new Map<string, CustomAgent>()

export const customAgentRegistry = {
  /** The id arrives minted, `<pluginId>:<localId>`, so a plugin cannot take a person's id or another
   *  plugin's. A second registration under one id replaces the first. */
  register(agent: CustomAgent): () => void {
    contributed.set(agent.id, agent)
    return () => {
      if (contributed.get(agent.id) === agent) contributed.delete(agent.id)
    }
  },
  list: (): CustomAgent[] => [...contributed.values()],
}

// A session row names a harness twice, as `providerId` and `profileId`, and the two differ only for
// Claude Code, where both names predate the harness seam. Every other harness, built in or contributed,
// uses one id for both (./harnessRegistry.ts § launchSpec).
const PROFILE_FOR_PROVIDER: Readonly<Record<string, string>> = { [claudeHarness.id]: claudeHarness.profileId }

/** A plugin's agent as the list holds it. The host already minted the id and qualified the harness. */
export const contributedCustomAgent = (agent: ManifestCustomAgent): CustomAgent => ({
  id: agent.id,
  name: agent.name,
  ...(agent.glyph ? { glyph: agent.glyph } : {}),
  ...(agent.description ? { description: agent.description } : {}),
  providerId: agent.providerId,
  profileId: PROFILE_FOR_PROVIDER[agent.providerId] ?? agent.providerId,
  options: agent.options,
  ...(agent.instructions ? { instructions: agent.instructions } : {}),
  ...(agent.maxToolRisk ? { maxToolRisk: agent.maxToolRisk } : {}),
  source: { kind: 'plugin', pluginId: agent.pluginId },
})

async function readOwn(prefs: PrefService, userId: string): Promise<CustomAgent[]> {
  return parseStoredCustomAgents(await prefs.read(userId, customAgentsPreferenceKey))
}

/** The owner's agents first, in their order, then every plugin's. */
export async function readCustomAgents(prefs: PrefService, userId: string): Promise<CustomAgent[]> {
  return [...await readOwn(prefs, userId), ...customAgentRegistry.list()]
}

/**
 * Create one, or replace one of the owner's by id. Read, change, write, in one process: two tabs
 * saving at once can lose the earlier write, and that is the same exposure every prefs row has.
 */
export async function saveCustomAgent(
  prefs: PrefService,
  userId: string,
  id: string | null,
  input: CustomAgentInput,
): Promise<CustomAgent> {
  const agents = await readOwn(prefs, userId)
  if (id && customAgentRegistry.list().some((agent) => agent.id === id)) {
    throw new BridgeError(400, 'bad_request', 'A plugin provides this agent, so it cannot be edited. Duplicate it instead.')
  }
  const index = id ? agents.findIndex((agent) => agent.id === id) : -1
  if (id && index < 0) throw new BridgeError(404, 'not_found', 'Custom agent not found.')
  if (index < 0 && agents.length >= MAX_CUSTOM_AGENTS) {
    throw new BridgeError(400, 'bad_request', `You can keep at most ${MAX_CUSTOM_AGENTS} custom agents.`)
  }
  const saved: CustomAgent = { ...input, id: id ?? randomUUID(), source: { kind: 'user' } }
  const next = index < 0 ? [...agents, saved] : agents.map((agent, at) => at === index ? saved : agent)
  await prefs.write(userId, customAgentsPreferenceKey, serializeCustomAgents(next))
  return saved
}

export async function deleteCustomAgent(prefs: PrefService, userId: string, id: string): Promise<void> {
  const agents = await readOwn(prefs, userId)
  const next = agents.filter((agent) => agent.id !== id)
  if (next.length === agents.length) throw new BridgeError(404, 'not_found', 'Custom agent not found.')
  await prefs.write(userId, customAgentsPreferenceKey, serializeCustomAgents(next))
}
