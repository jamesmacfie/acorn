import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// `account.service`: a request to the account service as the Node's signed-in owner, for a compiled plugin
// that works with a hosted part of it, such as the Slack gateway (docs/account-api/slack-gateway.md). The
// address is the one this Node signs in to, and the access token is added, renewed by the host as any
// connection's is. Loaded plugins have no grant for it.
export type AccountService = {
  /** `path` is on the service's own origin, such as `/slack/v1/calls`. Rejects with `AccountNotSignedInError`
   *  when nobody is signed in, or the build has no account service. */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /** An address on the service's website, such as the phone app's `/t/<task ID>`. Empty when the build has
   *  no account service. */
  url(path: string): Promise<string>
}

export const ACCOUNT_SERVICE = capabilityId<AccountService>('account.service')

export class AccountNotSignedInError extends Error {
  readonly code = 'not_signed_in'
  constructor() {
    super('Sign in to your acorn account first.')
  }
}
