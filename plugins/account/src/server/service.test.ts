import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountNotSignedInError } from '../contract/service'
import { slackGatewayPaths } from '@acorn/protocol/account.ts'
import { serviceNodes, slackGatewayFetch } from './service'

// `account.service` as a plugin calls it. The host owns renewing the access token, so `withConnection`
// stands in for it here: whatever token it hands over is the one the request carries.

type Context = Parameters<typeof slackGatewayFetch>[0]

const sent: { request: Request; redirect: RequestRedirect | undefined }[] = []
// How many times a call borrowed the owner's token.
let borrowed = 0
const ctx = (owner: string | null, token: string | null) =>
  ({
    core: { identity: { active: () => owner } },
    providers: {
      withConnection: async (_owner: string, _provider: string, use: (c: unknown, t: string) => Promise<unknown>) => {
        borrowed++
        return token === null ? undefined : use({}, token)
      },
    },
  }) as unknown as Context

beforeEach(() => {
  vi.stubEnv('ACORN_ACCOUNT_URL', 'http://127.0.0.1:4999')
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    sent.push({ request: new Request(url, init), redirect: init.redirect })
    return Response.json({ nodes: [] })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  sent.length = 0
  borrowed = 0
})

it('refuses with not_signed_in when nobody is signed in, or the owner has no connection', async () => {
  const links = { method: 'GET', path: slackGatewayPaths.links } as const
  await expect(slackGatewayFetch(ctx(null, 'token'), links)).rejects.toBeInstanceOf(AccountNotSignedInError)
  await expect(slackGatewayFetch(ctx('james', null), links)).rejects.toBeInstanceOf(AccountNotSignedInError)
  await expect(serviceNodes(ctx('james', null))).rejects.toBeInstanceOf(AccountNotSignedInError)
  expect(sent).toEqual([])
})

it('refuses with not_signed_in on a build with no account service', async () => {
  vi.stubEnv('ACORN_ACCOUNT_URL', '')
  await expect(
    slackGatewayFetch(ctx('james', 'token'), { method: 'GET', path: slackGatewayPaths.links }),
  ).rejects.toBeInstanceOf(AccountNotSignedInError)
})

it("sends the token the host hands over, renewed or not, to a Slack gateway route on the service's origin", async () => {
  await slackGatewayFetch(ctx('james', 'renewed-token'), {
    method: 'POST',
    path: slackGatewayPaths.calls,
    body: { teamId: 'T1' },
  })
  expect(sent[0]!.request.url).toBe('http://127.0.0.1:4999/slack/v1/calls')
  expect(sent[0]!.request.headers.get('authorization')).toBe('Bearer renewed-token')
  expect(sent[0]!.request.headers.get('content-type')).toBe('application/json')
  expect(await sent[0]!.request.text()).toBe('{"teamId":"T1"}')
  expect(sent[0]!.redirect).toBe('error')
})

it('accepts every Slack gateway route a Node calls', async () => {
  const paths = [
    slackGatewayPaths.links,
    slackGatewayPaths.link('T 1/x'),
    slackGatewayPaths.calls,
    slackGatewayPaths.grant('T1', 'C1', '1700000000.000100'),
  ]
  for (const path of paths) await slackGatewayFetch(ctx('james', 'token'), { method: 'GET', path })
  expect(sent.map(({ request }) => new URL(request.url).pathname)).toEqual(paths)
})

it('refuses any other destination before it borrows the token or makes a request', async () => {
  const refused = [
    'https://attacker.test/slack/v1/calls',
    '//attacker.test/slack/v1/calls',
    '/account/v1/tickets',
    '/account/v1/nodes/node-1',
    '/slack/v1/links/../../account/v1/tickets',
    '/slack/v1/calls?next=/account/v1/tickets',
    '/slack/v1/events',
  ]
  for (const path of refused)
    await expect(slackGatewayFetch(ctx('james', 'token'), { method: 'POST', path }), path).rejects.toThrow(
      /only to a Slack gateway route/,
    )
  expect(borrowed).toBe(0)
  expect(sent).toEqual([])
})

it("lists the account's Nodes with the owner's token", async () => {
  expect(await serviceNodes(ctx('james', 'token'))).toEqual([])
  expect(sent[0]!.request.url).toBe('http://127.0.0.1:4999/account/v1/nodes')
  expect(sent[0]!.request.headers.get('authorization')).toBe('Bearer token')
})
