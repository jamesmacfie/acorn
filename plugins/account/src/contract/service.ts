import type { ListNodesResponse } from '@acorn/protocol/account.ts'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// `account.service`: the account service as the Node's signed-in owner, for a compiled plugin that works
// with a hosted part of it, such as the Slack gateway (docs/account-api/slack-gateway.md). Each method is
// one kind of request, so the owner's access token reaches only the routes a consumer needs. The host
// renews the token as it does any connection's. Loaded plugins can't resolve this capability.
export type AccountService = {
  /** A call to one of the Slack gateway's Node routes, `slackGatewayPaths.links`, `.link`, `.calls`, or
   *  `.grant`, with `body` sent as JSON. Any other path rejects before the token is read. Rejects with
   *  `AccountNotSignedInError` when nobody is signed in, or the build has no account service. */
  slackGateway(request: SlackGatewayRequest): Promise<Response>
  /** The signed-in account's Nodes. Rejects like `slackGateway`. */
  nodes(): Promise<ListNodesResponse['nodes']>
  /** An address on the service's website, such as the phone app's `/t/<task ID>`. Empty when the build has
   *  no account service. */
  url(path: string): Promise<string>
}

export type SlackGatewayRequest = {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  body?: unknown
  signal?: AbortSignal
}

export const ACCOUNT_SERVICE = capabilityId<AccountService>('account.service')

export class AccountNotSignedInError extends Error {
  readonly code = 'not_signed_in'
  constructor() {
    super('Sign in to your acorn account first.')
  }
}
