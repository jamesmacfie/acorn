import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountNotSignedInError } from '../contract/service'
import { serviceFetch } from './service'

// `account.service` as a plugin calls it. The host owns renewing the access token, so `withConnection`
// stands in for it here: whatever token it hands over is the one the request carries.

type Context = Parameters<typeof serviceFetch>[0]

const sent: Request[] = []
const ctx = (owner: string | null, token: string | null) =>
  ({
    core: { identity: { active: () => owner } },
    providers: {
      withConnection: async (_owner: string, _provider: string, use: (c: unknown, t: string) => Promise<Response>) =>
        token === null ? undefined : use({}, token),
    },
  }) as unknown as Context

beforeEach(() => {
  vi.stubEnv('ACORN_ACCOUNT_URL', 'http://127.0.0.1:4999')
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    sent.push(new Request(url, init))
    return new Response('{}')
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  sent.length = 0
})

it('refuses with not_signed_in when nobody is signed in, or the owner has no connection', async () => {
  await expect(serviceFetch(ctx(null, 'token'), '/slack/v1/links')).rejects.toBeInstanceOf(AccountNotSignedInError)
  await expect(serviceFetch(ctx('james', null), '/slack/v1/links')).rejects.toBeInstanceOf(AccountNotSignedInError)
  expect(sent).toEqual([])
})

it('refuses with not_signed_in on a build with no account service', async () => {
  vi.stubEnv('ACORN_ACCOUNT_URL', '')
  await expect(serviceFetch(ctx('james', 'token'), '/slack/v1/links')).rejects.toBeInstanceOf(AccountNotSignedInError)
})

it("sends the token the host hands over, renewed or not, to the service's own origin", async () => {
  await serviceFetch(ctx('james', 'renewed-token'), '/slack/v1/calls', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer stale' },
    body: '{}',
  })
  expect(sent[0]!.url).toBe('http://127.0.0.1:4999/slack/v1/calls')
  expect(sent[0]!.headers.get('authorization')).toBe('Bearer renewed-token')
  expect(sent[0]!.headers.get('content-type')).toBe('application/json')
})
