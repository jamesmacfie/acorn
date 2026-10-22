import { describe, expect, it } from 'vitest'
import { acceptChannel, openChannel } from './secure'
import { channelIdentity, socketPair } from './testkit'

const text = (bytes: Uint8Array | null) => new TextDecoder().decode(bytes ?? new Uint8Array())

describe('the phone channel', () => {
  it('carries messages both ways once the phone has checked the Node’s key', async () => {
    const node = await channelIdentity()
    const [phoneSocket, nodeSocket] = socketPair()
    const [phone, accepted] = await Promise.all([
      openChannel(phoneSocket, node.publicKey),
      acceptChannel(nodeSocket, node.identity),
    ])
    await phone.write(new TextEncoder().encode('from the phone'))
    expect(text(await accepted.read())).toBe('from the phone')
    await accepted.write(new TextEncoder().encode('from the Node'))
    expect(text(await phone.read())).toBe('from the Node')
  })

  it('carries a message larger than one encrypted record, intact', async () => {
    const node = await channelIdentity()
    const [phoneSocket, nodeSocket] = socketPair()
    const [phone, accepted] = await Promise.all([
      openChannel(phoneSocket, node.publicKey),
      acceptChannel(nodeSocket, node.identity),
    ])
    const big = Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, i) => i % 251)
    await phone.write(big)
    const received = (await accepted.read())!
    // Not `toEqual`, which compares typed arrays an element at a time, slowly.
    expect(received.byteLength).toBe(big.byteLength)
    expect(received.every((byte, index) => byte === big[index])).toBe(true)
  })

  it('refuses a Node whose key is not the one pinned, and the Node sees no message', async () => {
    const node = await channelIdentity()
    const [phoneSocket, nodeSocket] = socketPair()
    const result = await Promise.allSettled([
      openChannel(phoneSocket, (await channelIdentity()).publicKey),
      acceptChannel(nodeSocket, node.identity),
    ])
    expect(result[0]).toMatchObject({ status: 'rejected' })
    expect(String((result[0] as PromiseRejectedResult).reason)).toMatch(/identity key/i)
  })

  it('ends a read with null when the other end closes', async () => {
    const node = await channelIdentity()
    const [phoneSocket, nodeSocket] = socketPair()
    const [phone, accepted] = await Promise.all([
      openChannel(phoneSocket, node.publicKey),
      acceptChannel(nodeSocket, node.identity),
    ])
    phone.close()
    expect(await accepted.read()).toBeNull()
  })
})
