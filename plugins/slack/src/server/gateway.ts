import { z } from 'zod'
import {
  createSlackLinkResponseSchema,
  listSlackLinksResponseSchema,
  slackCallResponseSchema,
  slackGatewayErrorSchema,
  slackGatewayPaths,
  type CreateSlackLinkResponse,
  type SlackCallMethod,
  type SlackGatewayError as GatewayRefusalBody,
  type SlackLink,
} from '@acorn/protocol/account.ts'
import type { AccountService } from '@acorn/plugin-account/contract/service.ts'

// The hosted Slack gateway as this Node calls it (docs/account-api/slack-gateway.md § Calls from a Node),
// through the account plugin's sign-in. The Node holds no Slack token: each Slack call is the gateway's,
// held to the threads this Node holds.

/** What the gateway refused with, or `unavailable` when it didn't answer as the contract says. */
export class GatewayCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: GatewayRefusalBody['error'] | 'unavailable',
    readonly retryAfter?: number,
    readonly slackError?: string,
  ) {
    super(`The Slack gateway answered ${status} ${code}${slackError ? ` (${slackError})` : ''}.`)
  }
}

export type SlackGateway = {
  call(teamId: string, method: SlackCallMethod, args: Record<string, unknown>): Promise<Record<string, unknown>>
  links(): Promise<SlackLink[]>
  startLink(nodeId: string): Promise<CreateSlackLinkResponse>
  unlink(teamId: string): Promise<void>
  releaseGrant(teamId: string, channelId: string, threadTs: string): Promise<void>
}

export function slackGateway(service: AccountService): SlackGateway {
  async function request<S extends z.ZodType>(method: string, path: string, schema: S, body?: unknown) {
    const response = await service.fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    const json: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
    if (!response.ok) {
      const refusal = slackGatewayErrorSchema.safeParse(json)
      if (!refusal.success) throw new GatewayCallError(response.status, 'unavailable')
      throw new GatewayCallError(response.status, refusal.data.error, refusal.data.retryAfter, refusal.data.message)
    }
    const answer = schema.safeParse(json)
    if (!answer.success) throw new GatewayCallError(response.status, 'unavailable')
    return answer.data as z.infer<S>
  }

  return {
    call: async (teamId, method, args) =>
      (await request('POST', slackGatewayPaths.calls, slackCallResponseSchema, { teamId, method, args })).result,
    links: async () => (await request('GET', slackGatewayPaths.links, listSlackLinksResponseSchema)).links,
    startLink: (nodeId) => request('POST', slackGatewayPaths.links, createSlackLinkResponseSchema, { nodeId }),
    unlink: async (teamId) => void (await request('DELETE', slackGatewayPaths.link(teamId), z.undefined())),
    releaseGrant: async (teamId, channelId, threadTs) =>
      void (await request('DELETE', slackGatewayPaths.grant(teamId, channelId, threadTs), z.undefined())),
  }
}
