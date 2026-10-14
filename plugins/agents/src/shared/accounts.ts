import type { AgentProviderDescriptor } from '../contract/wire.ts'

// A second subscription for one harness: a named login in a config folder the Node owns
// (docs/managed-agents/accounts.md). The name is the folder's name, so it doubles as the id.

/** Lowercase letters, digits and dashes, because the name becomes a folder and part of a shell line. */
export const ACCOUNT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

export const isAccountName = (value: unknown): value is string =>
  typeof value === 'string' && ACCOUNT_NAME_PATTERN.test(value)

/** The account a session started under, or null for the harness's own default login. Pinned at
 *  creation, because the CLI resumes a session only from the folder that holds it. */
export const sessionAccount = (config: Record<string, unknown>): string | null =>
  isAccountName(config.account) ? config.account : null

/** Whether the login a start would use is signed in: the default one, or the named account's. An
 *  account the Node doesn't hold reads as signed out. */
export function signedIn(provider: AgentProviderDescriptor, account: string | null): boolean | null {
  if (!account) return provider.authenticated
  return provider.accounts?.find((candidate) => candidate.name === account)?.authenticated ?? false
}

/** What a surface calls an account: the display name the person gave it, else its folder's name. */
export const accountLabel = (provider: AgentProviderDescriptor | undefined, account: string): string =>
  provider?.accounts?.find((candidate) => candidate.name === account)?.label ?? account

/** The icon a surface draws in place of an account's name: set when the person chose icons for the
 *  harness and gave this account one. Undefined means the surface names the account. */
export function accountIcon(provider: AgentProviderDescriptor | undefined, account: string | null): string | undefined {
  if (provider?.accountDisplay !== 'icon' || !account) return undefined
  return provider.accounts?.find((candidate) => candidate.name === account)?.icon
}
