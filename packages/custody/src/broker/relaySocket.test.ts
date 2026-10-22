import { describe, expect, it } from 'vitest'
import { parseNodeAddress, relayCredentialFor } from './relaySocket'

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

  it('is a relay route with no credential when the account supplies tickets', () => {
    expect(parseNodeAddress(`wss://example.com/${NODE}`)).toEqual({
      endpoint: `https://${NODE}.relay.acorn`,
      relay: { url: 'wss://example.com', route: NODE },
    })
  })

  it('gives an address with a credential no ticket, and keeps a ticket off plain ws:// to another computer', async () => {
    const ticketFor = async () => 'ticket'
    const route = (url: string) => ({ url, route: NODE })
    expect(await relayCredentialFor('typed', route('wss://example.com'), ticketFor)).toBe('typed')
    expect(await relayCredentialFor(undefined, route('wss://example.com'), ticketFor)).toBe('ticket')
    expect(await relayCredentialFor(undefined, route('ws://127.0.0.1:9'), ticketFor)).toBe('ticket')
    await expect(relayCredentialFor(undefined, route('ws://example.com'), ticketFor)).rejects.toThrow(/wss:\/\//)
    await expect(relayCredentialFor(undefined, route('wss://example.com'), undefined)).rejects.toThrow(/no credential/)
  })

  it('says what is wrong, without repeating the credential', () => {
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
