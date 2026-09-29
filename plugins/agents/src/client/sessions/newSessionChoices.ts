import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import type { CustomAgent } from '../../shared/customAgents'

/** One row of New: a harness on its own, or a custom agent and the harness it runs on. */
export type NewSessionChoice = { provider: AgentProviderDescriptor; agent?: CustomAgent }

/**
 * The harnesses first, then the custom agents, for the pane's New picker, its empty-state cards and
 * the palette, so the three never list different things. An agent whose harness this node does not
 * register at all is left out, since nothing could start it; one whose harness is registered but not
 * installed stays, disabled, beside that harness.
 */
export function newSessionChoices(
  providers: readonly AgentProviderDescriptor[],
  agents: readonly CustomAgent[],
): NewSessionChoice[] {
  return [
    ...providers.map((provider) => ({ provider })),
    ...agents.flatMap((agent) => {
      const provider = providers.find((candidate) => candidate.id === agent.providerId)
      return provider ? [{ provider, agent }] : []
    }),
  ]
}

export const choiceLabel = (choice: NewSessionChoice): string => choice.agent?.name ?? choice.provider.label

export const choiceGlyph = (choice: NewSessionChoice): string | undefined => choice.agent?.glyph ?? choice.provider.glyph

/** What the row says under its name. For an agent, the harness and the values it sets, which is what
 *  tells two agents on one harness apart. */
export function choiceDescription(choice: NewSessionChoice): string {
  const { provider, agent } = choice
  if (!provider.installed) return provider.diagnostics[0] ?? 'Not installed'
  if (!agent) return provider.executableVersion ?? 'Available'
  return agent.description || [provider.label, ...Object.values(agent.options)].join(' · ')
}
