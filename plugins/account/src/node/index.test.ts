import { afterEach, expect, it, vi } from 'vitest'
import { connectionProviderRegistry, makeTestNodeContext } from '@acorn/plugin-api/testkit'
import { accountPlugin } from './index'

// A Node that nobody signed in on runs no account code (docs/account-api.md § The sign-in plugin):
// starting the plugin registers a connection and its routes, and opens no connection and no timer.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('starts without a request, a timer, or an interval, even with an account service configured', async () => {
  vi.stubEnv('ACORN_ACCOUNT_URL', 'https://account.example.test')
  // The host's own context starts timers, so watch only what the plugin does.
  const ctx = makeTestNodeContext({ plugin: accountPlugin() })
  const fetch = vi.spyOn(globalThis, 'fetch')
  const timeout = vi.spyOn(globalThis, 'setTimeout')
  const interval = vi.spyOn(globalThis, 'setInterval')

  await accountPlugin().init(ctx)

  expect(fetch).not.toHaveBeenCalled()
  expect(timeout).not.toHaveBeenCalled()
  expect(interval).not.toHaveBeenCalled()
  expect(connectionProviderRegistry.get('account')?.connection.connectable).toBe(true)
})
