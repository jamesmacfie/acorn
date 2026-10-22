import { generateKeyPair } from '@libp2p/crypto/keys'
import type { ChannelIdentity, ChannelSocket } from './secure.ts'

// Two sockets joined back to back, the way a relay joins a phone's stream to a Node's. Closing one
// closes both.
export function socketPair(): [ChannelSocket, ChannelSocket] {
  type End = ChannelSocket & { peer?: End; target: EventTarget }
  const end = (): End => {
    const target = new EventTarget()
    const self: End = {
      target,
      binaryType: 'blob',
      bufferedAmount: 0,
      send(data) {
        // A real socket copies what it is given.
        const copy = new Uint8Array(data).buffer
        queueMicrotask(() => self.peer!.target.dispatchEvent(Object.assign(new Event('message'), { data: copy })))
      },
      close() {
        queueMicrotask(() => {
          for (const each of [self, self.peer!])
            each.target.dispatchEvent(Object.assign(new Event('close'), { wasClean: true }))
        })
      },
      addEventListener: (type: string, listener: (event: never) => void, options?: { once: boolean }) =>
        target.addEventListener(type, listener as EventListener, options),
    }
    return self
  }
  const a = end()
  const b = end()
  a.peer = b
  b.peer = a
  return [a, b]
}

const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** A Node's channel identity, with the public key as a phone is told it. */
export async function channelIdentity(): Promise<{ identity: ChannelIdentity; publicKey: string }> {
  const key = await generateKeyPair('Ed25519')
  const publicKey = key.publicKey.raw
  return { identity: { seed: key.raw.subarray(0, 32), publicKey }, publicKey: hex(publicKey) }
}
