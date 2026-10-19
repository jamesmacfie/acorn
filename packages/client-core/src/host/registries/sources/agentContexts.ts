import { RESERVED_AGENT_CONTEXT_KEYWORDS, type AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { Registry } from '../../../kit/lib/state/registry'

export const agentContextRegistry = new Registry<AgentContextContribution>('agent context')

export const agentContextContributions = (): readonly AgentContextContribution[] =>
  [...agentContextRegistry.entries()].sort((a, b) => a.label.localeCompare(b.label))

// `Saved_Requests` or `acme.tools` as a keyword: lowercase, runs of anything else as one hyphen, and a
// letter first.
const asKeyword = (value: string): string => {
  const keyword = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z]/.test(keyword) ? keyword : `p-${keyword}`
}

/**
 * The keyword a loaded plugin's source is bound to: the one it asked for, or its entry id when it
 * asked for none, qualified as `<pluginId>-<keyword>` when that is reserved for a first-party source or
 * already taken. Qualified rather than refused, because two independent plugins can't coordinate names.
 */
export function loadedAgentContextKeyword(pluginId: string, wanted: string): string {
  const keyword = asKeyword(wanted)
  const taken = (candidate: string) =>
    RESERVED_AGENT_CONTEXT_KEYWORDS.has(candidate) ||
    agentContextRegistry.entries().some((entry) => entry.keyword === candidate)
  return taken(keyword) ? asKeyword(`${pluginId}-${keyword}`) : keyword
}
