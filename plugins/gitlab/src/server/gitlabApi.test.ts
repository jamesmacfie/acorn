import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeFakeGitlab } from './fakeGitlab.helper'
import { gl, glGraphQL } from './gitlabApi'

let fake: ReturnType<typeof makeFakeGitlab>
beforeEach(() => {
  fake = makeFakeGitlab([])
  vi.stubGlobal('fetch', fake.fetch)
})
afterEach(() => vi.unstubAllGlobals())

it('renews a refused token once and retries with the renewed one', async () => {
  fake.tokens.clear()
  fake.tokens.add('renewed')
  const refresh = vi.fn(async () => 'renewed')
  const session = { token: 'expired', refresh }
  expect((await gl(session, '/user')).status).toBe(200)
  expect(refresh).toHaveBeenCalledOnce()
  expect(session.token).toBe('renewed')
  expect(fake.requests.map((request) => request.authorization)).toEqual(['Bearer expired', 'Bearer renewed'])
})

it('answers the refusal when the renewal is refused too, and calls nobody with no token', async () => {
  fake.tokens.clear()
  expect((await gl({ token: 'expired', refresh: async () => '' }, '/user')).status).toBe(401)
  expect(await glGraphQL({ token: '' }, 'query X { x }', {})).toEqual({
    ok: false,
    failure: { error: 'reauth', status: 401 },
  })
  expect(fake.requests).toHaveLength(1)
})
