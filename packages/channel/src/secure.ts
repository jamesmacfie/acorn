import { noise } from '@chainsafe/libp2p-noise'
import { generateKeyPair, privateKeyFromRaw, publicKeyFromRaw } from '@libp2p/crypto/keys'
import type { PrivateKey } from '@libp2p/interface'
import { defaultLogger } from '@libp2p/logger'
import { peerIdFromPublicKey } from '@libp2p/peer-id'
import { AbstractMessageStream, lpStream } from '@libp2p/utils'
import { CHANNEL_HANDSHAKE_TIMEOUT_MS, CHANNEL_MAX_MESSAGE_BYTES } from '@acorn/protocol/channel.ts'

// The phone's encrypted channel to a Node (docs/relay/phone-channel.md): a Noise XX handshake from
// `@chainsafe/libp2p-noise` over one relay stream, then length-prefixed messages inside it. A Node and a
// phone's browser run this same code.
//
// The Node holds an Ed25519 identity key, and the handshake signs the session's keys with it. The phone
// pins that key's public half, so a relay that sends it to some other Node can't complete a handshake. The
// phone's own identity is made fresh for each connection and means nothing: the Node learns who it is
// talking to from the device token inside the channel.

// The slice of a WebSocket this needs, which a browser's and the `ws` package's both satisfy.
export type ChannelSocket = {
  binaryType: string
  readonly bufferedAmount: number
  send(data: Uint8Array<ArrayBuffer>): void
  close(code?: number): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: (event: { wasClean: boolean }) => void, options?: { once: boolean }): void
}

// What a Node keeps of its identity: the 32-byte seed and the 32-byte public key it grows into.
export type ChannelIdentity = { seed: Uint8Array; publicKey: Uint8Array }

export type SecureChannel = {
  /** The next message, or null once the other end has closed. */
  read(): Promise<Uint8Array | null>
  write(message: Uint8Array): Promise<void>
  close(): void
}

const logger = defaultLogger()

// A socket that has this much queued is slow, and writers wait until it empties.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
const DRAIN_POLL_MS = 10

// libp2p's streams are built from this base class. A relay stream is a stream of binary messages, which
// it writes and reads whole.
class SocketStream extends AbstractMessageStream {
  private drainPoll: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly socket: ChannelSocket,
    direction: 'inbound' | 'outbound',
  ) {
    super({ log: logger.forComponent('acorn:channel'), direction })
    socket.binaryType = 'arraybuffer'
    socket.addEventListener(
      'close',
      (event) => {
        clearInterval(this.drainPoll)
        if (event.wasClean) this.onTransportClosed()
        else this.onRemoteReset()
      },
      { once: true },
    )
    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) this.onData(new Uint8Array(event.data))
      else this.abort(new Error('The relay sent a text message on a stream.'))
    })
  }
  sendData(data: Parameters<AbstractMessageStream['sendData']>[0]) {
    // What libp2p hands over is always a view of an ArrayBuffer, which its type doesn't say.
    for (const bytes of data) this.socket.send(bytes as Uint8Array<ArrayBuffer>)
    const canSendMore = this.socket.bufferedAmount < MAX_BUFFERED_BYTES
    if (!canSendMore) this.drainPoll ??= setInterval(() => this.checkDrained(), DRAIN_POLL_MS)
    return { sentBytes: data.byteLength, canSendMore }
  }
  // Sockets say nothing when their queue empties, so it's polled while a writer is waiting.
  private checkDrained(): void {
    if (this.socket.bufferedAmount > 0) return
    clearInterval(this.drainPoll)
    this.drainPoll = undefined
    this.safeDispatchEvent('drain')
  }
  sendReset(): void {
    this.socket.close(1006)
  }
  async close(): Promise<void> {
    this.socket.close()
  }
  sendPause(): void {}
  sendResume(): void {}
}

// The components libp2p would hand it. Muxers are skipped, so the upgrader only has to say it has none.
const encrypter = (privateKey: PrivateKey) =>
  noise()({
    peerId: peerIdFromPublicKey(privateKey.publicKey),
    privateKey,
    logger,
    upgrader: { getStreamMuxers: () => new Map() } as never,
  })

// Handshake options. Both ends give up on a peer that goes quiet instead of holding the stream.
const handshakeOptions = () => ({
  skipStreamMuxerNegotiation: true,
  signal: AbortSignal.timeout(CHANNEL_HANDSHAKE_TIMEOUT_MS),
})

async function wrap(
  encrypted: { close(): Promise<void> },
  stream: Parameters<typeof lpStream>[0],
): Promise<SecureChannel> {
  const messages = lpStream(stream, { maxDataLength: CHANNEL_MAX_MESSAGE_BYTES })
  return {
    read: () =>
      messages.read().then(
        (message) => message.subarray(),
        () => null,
      ),
    write: (message) => messages.write(message),
    close: () => void encrypted.close().catch(() => {}),
  }
}

export const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

/** The Node on the other end isn't the one pinned. Retrying can't fix it, and the phone must not go on. */
export class IdentityMismatchError extends Error {
  constructor(options?: ErrorOptions) {
    super('The Node answered with a different identity than the one this phone pinned.', options)
    this.name = 'IdentityMismatchError'
  }
}

// A handshake that fails leaves the stream to close, or the other end waits for a message that never comes.
async function closingOnFailure<T>(socket: ChannelSocket, handshake: Promise<T>): Promise<T> {
  try {
    return await handshake
  } catch (error) {
    socket.close()
    // libp2p's name for a peer whose identity key isn't the one the handshake was told to expect.
    throw error instanceof Error && error.name === 'UnexpectedPeerError'
      ? new IdentityMismatchError({ cause: error })
      : error
  }
}

/** The phone's side: run the handshake and refuse a Node whose key isn't `pinnedKey`, 64 hex characters. */
export async function openChannel(socket: ChannelSocket, pinnedKey: string): Promise<SecureChannel> {
  const remotePeer = peerIdFromPublicKey(publicKeyFromRaw(fromHex(pinnedKey)))
  const secured = await closingOnFailure(
    socket,
    generateKeyPair('Ed25519').then((key) =>
      encrypter(key).secureOutbound(new SocketStream(socket, 'outbound'), { remotePeer, ...handshakeOptions() }),
    ),
  )
  return wrap(secured.connection, secured.connection)
}

/** The Node's side: run the handshake as the owner of `identity`, with whoever is on the other end. */
export async function acceptChannel(socket: ChannelSocket, identity: ChannelIdentity): Promise<SecureChannel> {
  const privateKey = privateKeyFromRaw(Uint8Array.from([...identity.seed, ...identity.publicKey]))
  const secured = await closingOnFailure(
    socket,
    encrypter(privateKey).secureInbound(new SocketStream(socket, 'inbound'), handshakeOptions()),
  )
  return wrap(secured.connection, secured.connection)
}
