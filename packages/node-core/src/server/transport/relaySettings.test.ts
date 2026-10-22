import { afterEach, describe, expect, it } from 'vitest'
import { relaySettings } from './relaySettings'

const original = { url: process.env.ACORN_RELAY_URL, credential: process.env.ACORN_RELAY_CREDENTIAL }
const fromFile = { url: 'wss://relay.example', credential: 'from-node-json' }

afterEach(() => {
  for (const [name, value] of [
    ['ACORN_RELAY_URL', original.url],
    ['ACORN_RELAY_CREDENTIAL', original.credential],
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
