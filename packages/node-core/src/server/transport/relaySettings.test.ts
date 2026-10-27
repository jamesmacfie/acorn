import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountServiceUrl, relaySettings } from './relaySettings'

const original = {
  url: process.env.ACORN_RELAY_URL,
  credential: process.env.ACORN_RELAY_CREDENTIAL,
  account: process.env.ACORN_ACCOUNT_URL,
}
const fromFile = { url: 'wss://relay.example', credential: 'from-node-json' }

afterEach(() => {
  for (const [name, value] of [
    ['ACORN_RELAY_URL', original.url],
    ['ACORN_RELAY_CREDENTIAL', original.credential],
    ['ACORN_ACCOUNT_URL', original.account],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('relay settings', () => {
  it('are absent unless node.json or the environment names a relay', () => {
    delete process.env.ACORN_RELAY_URL
    delete process.env.ACORN_RELAY_CREDENTIAL
    expect(relaySettings({ relay: undefined })).toBeUndefined()
    expect(relaySettings({ relay: fromFile })).toEqual(fromFile)
  })

  it('come from the environment as a pair, over node.json', () => {
    process.env.ACORN_RELAY_URL = 'ws://127.0.0.1:8443'
    process.env.ACORN_RELAY_CREDENTIAL = 'from-environment'
    expect(relaySettings({ relay: fromFile })).toEqual({ url: 'ws://127.0.0.1:8443', credential: 'from-environment' })
    delete process.env.ACORN_RELAY_CREDENTIAL
    expect(() => relaySettings({ relay: fromFile })).toThrow(/both/)
  })

  it('refuse a relay URL that is not a WebSocket one', () => {
    delete process.env.ACORN_RELAY_URL
    delete process.env.ACORN_RELAY_CREDENTIAL
    expect(() => relaySettings({ relay: { url: 'https://relay.example', credential: 'x' } })).toThrow(/wss/)
  })
})

describe('the account service previews ask', () => {
  const named = (value: string | undefined): string | undefined => {
    if (value === undefined) delete process.env.ACORN_ACCOUNT_URL
    else process.env.ACORN_ACCOUNT_URL = value
    return accountServiceUrl()
  }

  it('is its origin, over https or over http on this computer', () => {
    expect(named('https://account.example/anything')).toBe('https://account.example')
    expect(named('http://127.0.0.1:48781')).toBe('http://127.0.0.1:48781')
    expect(named('http://localhost:8787/')).toBe('http://localhost:8787')
  })

  it('is absent when unset, not an address, or would send a credential over a network in the clear', () => {
    expect(named(undefined)).toBeUndefined()
    expect(named('  ')).toBeUndefined()
    expect(named('account.example')).toBeUndefined()
    expect(named('http://account.example')).toBeUndefined()
    expect(named('ftp://account.example')).toBeUndefined()
  })

  it("is the build's address when ACORN_ACCOUNT_URL is unset, and absent when it's set to empty", () => {
    vi.stubGlobal('__ACORN_RELEASE_ACCOUNT_URL__', 'https://account.example')
    try {
      expect(named(undefined)).toBe('https://account.example')
      expect(named('')).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
