import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startAccountStub, type AccountStub } from '@acorn/plugin-api/testkit'
import { accountUrl } from './config'
import { accountProvider } from './provider'

// The sign-in connection's own steps against the stand-in: the host calls `refresh` before the access
// token expires, and the service rotates the refresh token every time.

let account: AccountStub

beforeEach(async () => {
  account = await startAccountStub()
  vi.stubEnv('ACORN_ACCOUNT_URL', account.url)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await account.close()
})

it('offers sign-in only when the build has an account service', () => {
  expect(accountProvider().connection.connectable).toBe(true)
  vi.stubEnv('ACORN_ACCOUNT_URL', '')
  expect(accountProvider().connection.connectable).toBe(false)
})

it("falls back to the build's address when ACORN_ACCOUNT_URL is unset, and an empty one turns it off", () => {
  vi.stubGlobal('__ACORN_RELEASE_ACCOUNT_URL__', 'https://account.example.test')
  try {
    vi.stubEnv('ACORN_ACCOUNT_URL', undefined)
    expect(accountProvider().connection.connectable).toBe(true)
    expect(accountUrl()).toBe('https://account.example.test')
    vi.stubEnv('ACORN_ACCOUNT_URL', '')
    expect(accountProvider().connection.connectable).toBe(false)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('trades a refresh token for new tokens, and the old refresh token stops working', async () => {
  const { refreshToken } = await account.signIn('refreshing')
  const { refresh } = accountProvider().connection
  const next = await refresh!(refreshToken)
  expect(next.secret).toMatch(/^at_/)
  expect(next.refreshToken).not.toBe(refreshToken)
  expect(next.expiresAt).toBeGreaterThan(Date.now())
  await expect(refresh!(refreshToken)).rejects.toMatchObject({ code: 'provider_needs_auth' })
})

it('keeps the connection when the service is only unreachable', async () => {
  const { refreshToken } = await account.signIn('refreshing')
  await account.close()
  await expect(accountProvider().connection.refresh!(refreshToken)).rejects.toMatchObject({
    code: 'provider_unavailable',
  })
})

it('checks the access token when asked to test the connection', async () => {
  const { accessToken } = await account.signIn('testing')
  const { test } = accountProvider().connection
  expect(await test(accessToken, {})).toEqual({ ok: true })
  expect(await test('not-a-token', {})).toEqual({ ok: false, error: 'provider_needs_auth' })
})
