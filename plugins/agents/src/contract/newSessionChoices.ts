import type { AgentProviderDescriptor } from './wire.ts'
import { accountIcon, accountLabel, signedIn } from '../shared/accounts'
import type { CustomAgent } from '../shared/customAgents'

export type { CustomAgent }

// The rows of New: the desktop's pane picker and palette, and the browser extension's new-chat picker,
// whose native host builds them from the same two lists.

/** One row of New: a harness on its own, one of its extra accounts, or a custom agent and the harness
 *  it runs on. */
export type NewSessionChoice = { provider: AgentProviderDescriptor; agent?: CustomAgent; account?: string }

/**
 * The harnesses first, then the custom agents, for the pane's New picker, its empty-state cards and
 * the palette, so the three never list different things. A harness with extra accounts is listed as
 * those accounts instead, because once the person has named their logins the unnamed default is noise
 * (docs/managed-agents/accounts.md). Only rows that can start a session are listed: a harness that
 * isn't installed, a login that's signed out, and an agent whose harness is missing or signed out are
 * all left out. Settings > Agents still lists them, with the reason. With a single row left, a
 * surface can start it straight from New instead of opening a list.
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
  ].filter(choiceAvailable)
}

/** Whether New has at least one row for the harness, for the pickers that choose a harness rather
 *  than a row. */
export const providerStartable = (provider: AgentProviderDescriptor): boolean =>
  newSessionChoices([provider], []).length > 0

const defaultFirst = (provider: AgentProviderDescriptor) =>
  [...(provider.accounts ?? [])].sort(
    (left, right) => Number(right.name === provider.defaultAccount) - Number(left.name === provider.defaultAccount),
  )

// The login a start from this row runs on, picked the way the runtime picks it: the row's account,
// else the agent's, else the harness's default (server/sessions/runtime.ts).
function startAccount(choice: NewSessionChoice): string | null {
  const named = choice.account ?? choice.agent?.account
  return named && choice.provider.accounts?.some((account) => account.name === named)
    ? named
    : (choice.provider.defaultAccount ?? null)
}

/** Whether the row can start a session: the CLI is installed and the login it would use isn't known
 *  to be signed out. */
export const choiceAvailable = (choice: NewSessionChoice): boolean =>
  choice.provider.installed && signedIn(choice.provider, startAccount(choice)) !== false

/** What a start from this row names besides the harness. */
export const choiceStart = (choice: NewSessionChoice): { customAgentId?: string; account?: string } => ({
  ...(choice.agent ? { customAgentId: choice.agent.id } : {}),
  ...(choice.account ? { account: choice.account } : {}),
})

export const choiceLabel = (choice: NewSessionChoice): string =>
  choice.agent?.name ??
  (choice.account
    ? `${choice.provider.label} · ${accountLabel(choice.provider, choice.account)}`
    : choice.provider.label)

/** The account's icon, when the row draws it in place of the account's name. */
export const choiceAccountIcon = (choice: NewSessionChoice): string | undefined =>
  accountIcon(choice.provider, choice.account ?? null)

/** The name the row shows. It drops the account's name when the account's icon stands in for it.
 *  Search, the palette and screen readers keep `choiceLabel`. */
export const choiceText = (choice: NewSessionChoice): string =>
  choiceAccountIcon(choice) ? choice.provider.label : choiceLabel(choice)

export const choiceGlyph = (choice: NewSessionChoice): string | undefined =>
  choice.agent?.glyph ?? choice.provider.glyph

/** What the row says under its name. For an agent, the harness and the values it sets, which is what
 *  tells two agents on one harness apart. */
export function choiceDescription(choice: NewSessionChoice): string {
  const { provider, agent } = choice
  if (choice.account && choice.account === provider.defaultAccount) return 'Default account'
  if (!agent) return provider.executableVersion ?? 'Available'
  return agent.description || [provider.label, ...Object.values(agent.options)].join(' · ')
}
