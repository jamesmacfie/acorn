import type { NodePlugin } from '@acorn/plugin-api/node'
import { AccountNotSignedInError, type SlackGatewayRequest } from '../contract/service'
import { accountApi } from './accountApi'
import { accountUrl } from './config'
import { ACCOUNT_PROVIDER } from './provider'

type Context = Parameters<NonNullable<NodePlugin['init']>>[0]

// `account.service` (../contract/service.ts), loaded on its first call.

export const serviceUrl = (path: string): string => (accountUrl() ? new URL(path, accountUrl()).href : '')

// The Slack gateway routes a Node calls (`slackGatewayPaths` in @acorn/protocol/account.ts), each
// variable segment one encoded value. The rest of the account API, such as relay tickets and Node
// registration, stays the account plugin's own.
const SLACK_NODE_ROUTE = /^\/slack\/v1\/(?:links(?:\/[^/?#]+)?|calls|grants(?:\/[^/?#]+){3})$/

// Checked before the token is borrowed. `base` is the account origin (./config.ts). The parsed path has to equal the one given, which refuses another
// origin, a query, and a `..` segment that would resolve somewhere else on this one.
function slackGatewayUrl(base: string, path: string): URL {
  const url = new URL(path, base)
  if (url.origin !== base || url.pathname !== path || !SLACK_NODE_ROUTE.test(path))
    throw new Error(`account.service sends the account token only to a Slack gateway route, not to ${path}.`)
  return url
}

async function withOwnerToken<T>(ctx: Context, use: (token: string) => Promise<T>): Promise<T> {
  const owner = ctx.core.identity.active()
  if (!owner || !accountUrl()) throw new AccountNotSignedInError()
  const result = await ctx.providers.withConnection(owner, ACCOUNT_PROVIDER, (_connection, token) => use(token))
  if (result === undefined) throw new AccountNotSignedInError()
  return result
}

export async function slackGatewayFetch(ctx: Context, request: SlackGatewayRequest): Promise<Response> {
  const base = accountUrl()
  if (!base) throw new AccountNotSignedInError()
  const url = slackGatewayUrl(base, request.path)
  return withOwnerToken(ctx, (token) =>
    fetch(url, {
      method: request.method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: request.signal,
      // A followed redirect would carry the token past the route checked above.
      redirect: 'error',
    }),
  )
}

export const serviceNodes = async (ctx: Context) =>
  (await withOwnerToken(ctx, (token) => accountApi(accountUrl()).nodes(token))).nodes
