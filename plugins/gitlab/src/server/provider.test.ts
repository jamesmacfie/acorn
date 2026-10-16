import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeGitlab } from './fakeGitlab.helper'
import { createGitlabProvider } from './provider'

// The connection's two ways in and its refresh, against the fake's OAuth endpoints. Core stores and
// renews the tokens (`freshConnection`); this pins what the provider hands it.
describe('the GitLab connection', () => {
  let fake: ReturnType<typeof makeFakeGitlab>
  beforeEach(() => {
    fake = makeFakeGitlab([])
    vi.stubGlobal('fetch', fake.fetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  const provider = (clientId = 'client-1') => createGitlabProvider({ clientId: () => clientId }).connection

  it('keeps a device sign-in refresh token and its expiry, and none for a personal access token', async () => {
    const connection = provider()
    const expiresAt = Date.now() + 7_200_000
    const device = { accessToken: 'token', refreshToken: 'refresh-0', expiresAt: String(expiresAt) }
    expect(connection.normalize(device, await connection.validate(device))).toMatchObject({
      secret: 'token',
      label: 'ada',
      refresh: { refreshToken: 'refresh-0', expiresAt },
    })
    const typed = { token: 'token' }
    expect(connection.normalize(typed, await connection.validate(typed)).refresh).toBeUndefined()
    await expect(connection.validate({ token: 'wrong' })).rejects.toMatchObject({ code: 'provider_needs_auth' })
  })

  it('offers the token form alone when this build has no OAuth application', () => {
    expect(provider().kind).toBe('device-flow')
    expect(provider('').kind).toBe('fields')
    expect(provider('').fields.map((field) => field.id)).toEqual(['token', 'baseUrl', 'allowPrivate'])
  })

  it('trades a refresh token for new tokens, and treats a refused one as needing sign-in', async () => {
    const connection = provider()
    fake.grantRefreshToken('refresh-0')
    const renewed = await connection.refresh!('refresh-0')
    expect(renewed).toMatchObject({ secret: 'access-1', refreshToken: 'refresh-1' })
    expect(renewed.expiresAt).toBeGreaterThan(Date.now() + 7_000_000)
    expect(fake.requests.at(-1)?.body).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-0',
      client_id: 'client-1',
    })
    // GitLab rotates refresh tokens, so the spent one is refused.
    await expect(connection.refresh!('refresh-0')).rejects.toMatchObject({ code: 'provider_needs_auth' })
  })
})
