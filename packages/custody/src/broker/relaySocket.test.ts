import { describe, expect, it } from 'vitest'
import { parseNodeAddress } from './relaySocket'

const NODE = '0f5a2c1e-8a64-4b9e-9d3e-2f1b6c7d8e9f'

describe('a node address', () => {
  it('is a direct endpoint', () => {
    expect(parseNodeAddress(' https://192.168.1.9:7443/ ')).toEqual({ endpoint: 'https://192.168.1.9:7443' })
  })

  it('is a relay route, with the credential taken off it', () => {
    expect(parseNodeAddress(`wss://s3cr%40t@example.com/relay/${NODE}`)).toEqual({
      endpoint: `https://${NODE}.relay.acorn`,
      relay: { url: 'wss://example.com/relay', route: NODE },
      relayCredential: 's3cr@t',
    })
  })

  it('says what is missing, without repeating the credential', () => {
    expect(() => parseNodeAddress(`wss://example.com/${NODE}`)).toThrow(/credential before the relay host/)
    for (const address of [
      'wss://s3cret@example.com/',
      `wss://s3cret@example.com/${NODE}?x=1`,
      'ftp://s3cret@host',
      's3cret',
    ])
      expect(() => parseNodeAddress(address)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('s3cret') }),
      )
  })
})
