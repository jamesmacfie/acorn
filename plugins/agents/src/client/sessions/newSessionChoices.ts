import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import type { CustomAgent } from '../../shared/customAgents'

/** One row of New: a harness on its own, one of its extra accounts, or a custom agent and the harness
 *  it runs on. */
export type NewSessionChoice = { provider: AgentProviderDescriptor; agent?: CustomAgent; account?: string }

/**
 * The harnesses first, then the custom agents, for the pane's New picker, its empty-state cards and
 * the palette, so the three never list different things. A harness with extra accounts is listed as
 * those accounts instead, because once the person has named their logins the unnamed default is noise
 * (docs/managed-agents/accounts.md). An agent
 * whose harness this node does not register at all is left out, since nothing could start it; one
 * whose harness is registered but not installed stays, disabled, beside that harness. A custom agent
 * runs on its harness's default login.
 */
export function newSessionChoices(
  providers: readonly AgentProviderDescriptor[],
  agents: readonly CustomAgent[],
): NewSessionChoice[] {
  return [
    ...providers.flatMap((provider) =>
      provider.accounts?.length
        ? defaultFirst(provider).map((account) => ({ provider, account: account.name }))
        : [{ provider }],
    ),
    ...agents.flatMap((agent) => {
      const provider = providers.find((candidate) => candidate.id === agent.providerId)
      return provider ? [{ provider, agent }] : []
    }),
  ]
}

const defaultFirst = (provider: AgentProviderDescriptor) =>
  [...(provider.accounts ?? [])].sort(
    (left, right) => Number(right.name === provider.defaultAccount) - Number(left.name === provider.defaultAccount),
  )

const choiceAccount = (choice: NewSessionChoice) =>
  choice.account ? choice.provider.accounts?.find((account) => account.name === choice.account) : undefined

/** Whether the row can start a session. An account that is known to be signed out can't. */
export const choiceAvailable = (choice: NewSessionChoice): boolean =>
  choice.provider.installed && choiceAccount(choice)?.authenticated !== false

/** What a start from this row names besides the harness. */
export const choiceStart = (choice: NewSessionChoice): { customAgentId?: string; account?: string } => ({
  ...(choice.agent ? { customAgentId: choice.agent.id } : {}),
  ...(choice.account ? { account: choice.account } : {}),
})

export const choiceLabel = (choice: NewSessionChoice): string =>
  choice.agent?.name ?? (choice.account ? `${choice.provider.label} · ${choice.account}` : choice.provider.label)

export const choiceGlyph = (choice: NewSessionChoice): string | undefined =>
  choice.agent?.glyph ?? choice.provider.glyph

/** What the row says under its name. For an agent, the harness and the values it sets, which is what
 *  tells two agents on one harness apart. */
export function choiceDescription(choice: NewSessionChoice): string {
  const { provider, agent } = choice
  if (!provider.installed) return provider.diagnostics[0] ?? 'Not installed'
  if (choiceAccount(choice)?.authenticated === false) return 'Not signed in. Sign in from Settings > Agents.'
  if (choice.account && choice.account === provider.defaultAccount) return 'Default account'
  if (!agent) return provider.executableVersion ?? 'Available'
  return agent.description || [provider.label, ...Object.values(agent.options)].join(' · ')
}
