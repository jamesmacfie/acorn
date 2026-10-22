import {
  CHANNEL_PING_INTERVAL_MS,
  channelNodeMessageSchema,
  decodeChannelMessage,
  encodeChannelMessage,
  type ChannelClientMessage,
} from '@acorn/protocol/channel.ts'
import type { SecureChannel } from './secure.ts'

// The phone's end of an open channel: requests that wait for their answers, the event feed, and a
// heartbeat (docs/relay/phone-channel.md). It knows nothing of accounts, tickets, or reconnecting, which
// belong to whatever opened the channel and opens another when this one closes.

export type ChannelRequest = { method: string; path: string; headers: Record<string, string>; body?: Uint8Array }
export type ChannelResponse = { status: number; headers: Record<string, string>; body: Uint8Array }

/** A request the Node couldn't answer at all, as against one it answered with an error status. */
export class ChannelFailure extends Error {
  constructor(
    readonly code: 'bad_request' | 'response_too_large' | 'unreachable' | 'closed',
    message: string,
  ) {
    super(message)
  }
}

export type ChannelClient = {
  request(request: ChannelRequest, signal?: AbortSignal): Promise<ChannelResponse>
  /** Opens the event feed for a device token. False when the Node doesn't know the token. */
  openEvents(token: string): Promise<boolean>
  /** A client frame for the event feed, as JSON text. */
  sendFrame(json: string): void
  /** Resolves when the channel has closed, whichever end closed it. */
  closed: Promise<void>
  close(): void
}

export type ChannelListeners = {
  /** One event feed frame, as the JSON text the Node's hub wrote. */
  onFrame(json: string): void
  /** Terminal output. */
  onBytes(bytes: Uint8Array): void
}

type Waiting = { resolve(response: ChannelResponse): void; reject(error: ChannelFailure): void }

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

export function runChannelClient(channel: SecureChannel, listeners: ChannelListeners): ChannelClient {
  const waiting = new Map<string, Waiting>()
  let eventsAnswer: ((open: boolean) => void) | undefined
  let nextId = 0
  let heard = Date.now()
  let ended = false
  let writes: Promise<unknown> = Promise.resolve()

  // One message at a time goes into the stream, so two requests can't interleave.
  const post = (message: ChannelClientMessage, body?: Uint8Array): Promise<void> => {
    const sent = writes.then(() => channel.write(encodeChannelMessage(message, body)))
    writes = sent.catch(() => {})
    return sent
  }

  const end = (): void => {
    if (ended) return
    ended = true
    clearInterval(heartbeat)
    channel.close()
    for (const request of waiting.values()) request.reject(new ChannelFailure('closed', 'The channel closed.'))
    waiting.clear()
    eventsAnswer?.(false)
  }

  // Both ends ping, and a channel that has said nothing for two intervals is treated as gone, which is
  // how a phone that lost its network finds out without waiting for the socket to say so.
  const heartbeat = setInterval(() => {
    if (Date.now() - heard > 2 * CHANNEL_PING_INTERVAL_MS) return end()
    void post({ type: 'ping' }).catch(end)
  }, CHANNEL_PING_INTERVAL_MS)

  const closed = (async () => {
    for (let bytes = await channel.read(); bytes; bytes = await channel.read()) {
      heard = Date.now()
      const envelope = decodeChannelMessage(bytes, channelNodeMessageSchema)
      if (!envelope) continue
      const { message, body } = envelope
      if (message.type === 'response') {
        waiting.get(message.id)?.resolve({ status: message.status, headers: message.headers, body })
        waiting.delete(message.id)
      } else if (message.type === 'failure') {
        waiting.get(message.id)?.reject(new ChannelFailure(message.code, message.message))
        waiting.delete(message.id)
      } else if (message.type === 'events-open') eventsAnswer?.(true)
      else if (message.type === 'events-refused') eventsAnswer?.(false)
      else if (message.type === 'frame') listeners.onFrame(textDecoder.decode(body))
      else if (message.type === 'bytes') listeners.onBytes(body)
      else if (message.type === 'ping') void post({ type: 'pong' }).catch(end)
    }
    end()
  })()

  return {
    request({ method, path, headers, body }, signal) {
      if (ended) return Promise.reject(new ChannelFailure('closed', 'The channel closed.'))
      if (signal?.aborted) return Promise.reject(new DOMException('The request was aborted.', 'AbortError'))
      const id = String(++nextId)
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        signal?.addEventListener(
          'abort',
          () => {
            if (!waiting.delete(id)) return
            void post({ type: 'abort', id }).catch(() => {})
            reject(new DOMException('The request was aborted.', 'AbortError'))
          },
          { once: true },
        )
        void post({ type: 'request', id, method, path, headers }, body).catch(end)
      })
    },
    openEvents(token) {
      if (ended) return Promise.resolve(false)
      const open = new Promise<boolean>((resolve) => (eventsAnswer = resolve))
      void post({ type: 'events', token }).catch(end)
      return open
    },
    sendFrame: (json) => void post({ type: 'frame' }, textEncoder.encode(json)).catch(end),
    closed,
    close: end,
  }
}
