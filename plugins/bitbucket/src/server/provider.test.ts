import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeBitbucket } from './fakeBitbucket.helper'
import { bitbucketProvider } from './provider'

// The connection's one way in, against the fake: an Atlassian email and API token, kept as one basic
// auth secret.
describe('the Bitbucket connection', () => {
  beforeEach(() => vi.stubGlobal('fetch', makeFakeBitbucket([]).fetch))
  afterEach(() => vi.unstubAllGlobals())

  const connection = bitbucketProvider.connection

  it('keeps the email and token as one basic auth secret, named for the account', async () => {
    const typed = { email: ' ada@example.com ', token: 'token' }
    expect(connection.fields.map((field) => field.id)).toEqual(['email', 'token'])
    expect(connection.normalize(typed, await connection.validate(typed))).toMatchObject({
      secret: 'ada@example.com:token',
      label: 'ada',
    })
  })

  it("refuses a wrong token at validation with Bitbucket's own message", async () => {
    await expect(connection.validate({ email: 'ada@example.com', token: 'wrong' })).rejects.toMatchObject({
      code: 'provider_needs_auth',
      message: 'Bitbucket said: Invalid credentials. Check your email and API token.',
    })
    await expect(connection.validate({ token: 'token' })).rejects.toMatchObject({ code: 'provider_bad_config' })
  })
})
