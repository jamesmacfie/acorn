import { z } from 'zod'
import {
  accountPaths,
  accountErrorSchema,
  accountSchema,
  DEVICE_CODE_GRANT,
  assertionResponseSchema,
  deviceCodeResponseSchema,
  listNodesResponseSchema,
  registerNodeResponseSchema,
  ticketResponseSchema,
  tokenResponseSchema,
  type AccountError,
  type RegisterNodeRequest,
} from '@acorn/protocol/account.ts'

// The account API as the sign-in plugin calls it (docs/account-api.md). Every answer is parsed by the
// schema the API publishes, so a service that drifts from it fails here, with its status and code,
// rather than as an undefined deep inside a route.

// What a service refused with, or `unavailable` when it didn't answer or answered with something that
// isn't the API.
export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AccountError['error'] | 'unavailable',
  ) {
    super(`The account service answered ${status} ${code}.`)
  }
}

type Call = { token?: string; body?: unknown }

export function accountApi(baseUrl: string) {
  async function call<Schema extends z.ZodType>(
    method: string,
    path: string,
    schema: Schema,
    { token, body }: Call = {},
  ) {
    let response: Response
    try {
      response = await fetch(new URL(path, baseUrl), {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new AccountApiError(0, 'unavailable')
    }
    const json: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const refusal = accountErrorSchema.safeParse(json)
      throw new AccountApiError(response.status, refusal.success ? refusal.data.error : 'unavailable')
    }
    const answer = schema.safeParse(json)
    if (!answer.success) throw new AccountApiError(response.status, 'unavailable')
    return answer.data as z.infer<Schema>
  }

  return {
    deviceCode: (deviceName: string) =>
      call('POST', accountPaths.deviceCode, deviceCodeResponseSchema, { body: { deviceName } }),
    deviceToken: (deviceCode: string) =>
      call('POST', accountPaths.token, tokenResponseSchema, { body: { grantType: DEVICE_CODE_GRANT, deviceCode } }),
    refresh: (refreshToken: string) =>
      call('POST', accountPaths.token, tokenResponseSchema, { body: { grantType: 'refresh_token', refreshToken } }),
    account: (token: string) => call('GET', accountPaths.account, accountSchema, { token }),
    nodes: (token: string) => call('GET', accountPaths.nodes, listNodesResponseSchema, { token }),
    register: (token: string, nodeId: string, node: RegisterNodeRequest) =>
      call('PUT', accountPaths.node(nodeId), registerNodeResponseSchema, { token, body: node }),
    // The answer is 204, with no body.
    remove: (token: string, nodeId: string) => call('DELETE', accountPaths.node(nodeId), z.undefined(), { token }),
    ticket: (token: string, nodeId: string) =>
      call('POST', accountPaths.tickets, ticketResponseSchema, { token, body: { nodeId } }),
    assertion: (token: string, nodeId: string) =>
      call('POST', accountPaths.assertions, assertionResponseSchema, { token, body: { nodeId } }),
  }
}
