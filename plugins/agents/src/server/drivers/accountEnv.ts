import type { HarnessAccounts } from './types'

// Codex keeps everything, its login included, in CODEX_HOME. Here rather than in the driver, which is on
// the boot path, so the session start can share it without loading the driver's module graph.
export const CODEX_ACCOUNTS: HarnessAccounts = {
  env: 'CODEX_HOME',
  login: ['login'],
  logout: ['logout'],
  overrides: ['CODEX_API_KEY'],
}

/** A spawn environment pointed at one account's config folder (docs/managed-agents/accounts.md). Applied
 *  last, after the passthrough, so neither the Node's own copy of the variable nor a token that would
 *  override the folder's login reaches a session pinned to an account. */
export function withAccountHome(
  env: Record<string, string>,
  accounts: HarnessAccounts | undefined,
  home: string | undefined,
): Record<string, string> {
  if (!home) return env
  if (!accounts) throw new Error('This harness cannot run on a second account.')
  const out = { ...env, [accounts.env]: home }
  for (const name of accounts.overrides ?? []) delete out[name]
  return out
}
