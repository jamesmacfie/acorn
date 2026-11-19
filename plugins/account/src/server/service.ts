import type { NodePlugin } from '@acorn/plugin-api/node'
import { AccountNotSignedInError } from '../contract/service'
import { accountUrl } from './config'
import { ACCOUNT_PROVIDER } from './provider'

type Context = Parameters<NonNullable<NodePlugin['init']>>[0]

// `account.service` (../contract/service.ts), loaded on its first call.

export const serviceUrl = (path: string): string => (accountUrl() ? new URL(path, accountUrl()).href : '')

export async function serviceFetch(ctx: Context, path: string, init: RequestInit = {}): Promise<Response> {
  const owner = ctx.core.identity.active()
  const base = accountUrl()
  if (!owner || !base) throw new AccountNotSignedInError()
  const response = await ctx.providers.withConnection(owner, ACCOUNT_PROVIDER, (_connection, token) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    return fetch(new URL(path, base), { ...init, headers })
  })
  if (!response) throw new AccountNotSignedInError()
  return response
}
