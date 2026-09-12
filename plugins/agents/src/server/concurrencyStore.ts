import type { PrefService } from '@acorn/plugin-api/node'
import {
  agentConcurrencyPreferenceKey,
  parseAgentConcurrency,
  type AgentConcurrencyLimits,
} from '../shared/concurrency'

export async function readAgentConcurrency(
  prefs: PrefService,
  userId: string,
): Promise<AgentConcurrencyLimits> {
  return parseAgentConcurrency(await prefs.read(userId, agentConcurrencyPreferenceKey))
}

export async function writeAgentConcurrency(
  prefs: PrefService,
  userId: string,
  limits: AgentConcurrencyLimits,
): Promise<void> {
  await prefs.write(userId, agentConcurrencyPreferenceKey, JSON.stringify(limits))
}
