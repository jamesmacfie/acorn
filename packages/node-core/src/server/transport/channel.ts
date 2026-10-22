import { acceptChannel, type ChannelIdentity, type ChannelSocket, type SecureChannel } from '@acorn/channel/secure.ts'
import {
  CHANNEL_MAX_MESSAGE_BYTES,
  channelClientMessageSchema,
  decodeChannelMessage,
  encodeChannelMessage,
  type ChannelClientMessage,
  type ChannelNodeMessage,
} from '@acorn/protocol/channel.ts'
import { createLogger } from '../telemetry/logger'
import type { HubSocket, WsHub } from './wsHub'

const log = createLogger('channel')

// The Node's end of a phone's encrypted channel (docs/relay/phone-channel.md). A browser can't run TLS
// inside a relay stream or pin a certificate, so the phone runs a Noise handshake against the Node's channel
// key, and then speaks the messages in @acorn/protocol/channel.ts. A request becomes an ordinary call to
// the Node's own router, so authentication and routes run unchanged. The event feed joins the same
// hub a WebSocket does, through `HubSocket`.
//
// A channel is never a loopback peer, as no relayed stream is, so the routes that trust a caller on this
// computer refuse it. It marks its requests so the Node knows a phone's browser made them.

export type ChannelHost = {
  identity: ChannelIdentity
  /** The name this Node answers to for relayed traffic. */
  host: string
  /** An ordinary call to the Node's router, from a peer that isn't on this computer. */
  dispatch(request: Request): Promise<Response>
  hub: WsHub
}

// What describes the phone's connection and not the request, or would let a phone claim to be something it
// isn't. The device token travels in `authorization`, as it does for a native client.
const NOT_FORWARDED = new Set([
  'connection',
  'content-length',
  'cookie',
  'forwarded',
  'host',
  'keep-alive',
  'origin',
  'proxy-authorization',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-acorn-internal',
])
const NOT_RETURNED = new Set(['connection', 'content-length', 'keep-alive', 'set-cookie', 'transfer-encoding'])

const forwardedHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const lower = name.toLowerCase()
      return !NOT_FORWARDED.has(lower) && !lower.startsWith('sec-') && !lower.startsWith('x-forwarded-')
    }),
  )

const returnedHeaders = (headers: Headers): Record<string, string> =>
  Object.fromEntries([...headers].filter(([name]) => !NOT_RETURNED.has(name)))

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// The answer's bytes, or null when it is larger than a message can hold.
async function readLimited(response: Response, max: number): Promise<Uint8Array | null> {
  if (Number(response.headers.get('content-length')) > max) {
    void response.body?.cancel()
    return null
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      void reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

type Post = (message: ChannelNodeMessage, body?: Uint8Array) => Promise<boolean>

// The channel as the hub's socket: frames go out as messages, and the phone's frames come in as the
// text a socket would have delivered. `bufferedAmount` is what is written but not yet accepted by the
// relay stream, which is what lets the hub hold a terminal's output back from a slow phone.
class ChannelFeed implements HubSocket {
  readonly OPEN = 1
  private open = true
  private pending = 0
  private readonly listeners = new Map<string, ((argument?: unknown) => void)[]>()

  constructor(
    private readonly post: Post,
    private readonly end: () => void,
  ) {}

  get readyState(): number {
    return this.open ? this.OPEN : 3
  }
  get bufferedAmount(): number {
    return this.pending
  }

  send(
    data: string | Uint8Array,
    optionsOrCallback?: { binary?: boolean } | ((error?: Error) => void),
    maybeCallback?: (error?: Error) => void,
  ): void {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    const bytes = typeof data === 'string' ? textEncoder.encode(data) : data
    this.pending += bytes.byteLength
    void this.post({ type: typeof data === 'string' ? 'frame' : 'bytes' }, bytes).then((sent) => {
      this.pending -= bytes.byteLength
      callback?.(sent ? undefined : new Error('The channel is closed.'))
    })
  }
  ping(): void {
    void this.post({ type: 'ping' })
  }
  terminate(): void {
    this.end()
  }
  close(): void {
    this.end()
  }
  on(event: 'message', listener: (raw: { toString(): string }) => void): this
  on(event: 'pong' | 'close' | 'error', listener: () => void): this
  on(event: string, listener: (argument?: any) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  // What the channel tells the hub.
  receive(text: string): void {
    this.emit('message', { toString: () => text })
  }
  pong(): void {
    this.emit('pong')
  }
  closed(): void {
    if (!this.open) return
    this.open = false
    this.emit('close')
  }
  private emit(event: string, argument?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(argument)
  }
}

/** Run one phone's channel to its end. Resolves when the channel has closed. */
export async function serveChannel(socket: ChannelSocket, host: ChannelHost): Promise<void> {
  let channel: SecureChannel
  try {
    channel = await acceptChannel(socket, host.identity)
  } catch (error) {
    log.debug(`a phone's handshake failed: ${error instanceof Error ? error.message : error}`)
    return
  }
  const requests = new Map<string, AbortController>()
  let feed: ChannelFeed | undefined
  // One message at a time goes into the stream, so two answers can't interleave.
  let writes: Promise<unknown> = Promise.resolve()
  const post: Post = (message, body) => {
    const sent = writes.then(() => channel.write(encodeChannelMessage(message, body)))
    writes = sent.catch(() => {})
    return sent.then(
      () => true,
      () => false,
    )
  }

  async function answer(message: Extract<ChannelClientMessage, { type: 'request' }>, body: Uint8Array): Promise<void> {
    const { id } = message
    if (requests.has(id))
      return void post({ type: 'failure', id, code: 'bad_request', message: 'That request ID is in use.' })
    const controller = new AbortController()
    requests.set(id, controller)
    try {
      const method = message.method.toUpperCase()
      let request: Request
      try {
        request = new Request(`https://${host.host}${message.path}`, {
          method,
          headers: { ...forwardedHeaders(message.headers), host: host.host },
          ...(body.byteLength && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
          signal: controller.signal,
        })
      } catch {
        return void post({ type: 'failure', id, code: 'bad_request', message: 'The Node refused that request.' })
      }
      const response = await host.dispatch(request)
      const bytes = await readLimited(response, CHANNEL_MAX_MESSAGE_BYTES - 64 * 1024)
      if (!bytes)
        return void post({
          type: 'failure',
          id,
          code: 'response_too_large',
          message: 'The answer is too large to send.',
        })
      await post({ type: 'response', id, status: response.status, headers: returnedHeaders(response.headers) }, bytes)
    } catch (error) {
      if (!controller.signal.aborted)
        void post({
          type: 'failure',
          id,
          code: 'unreachable',
          message: error instanceof Error ? error.message : 'Failed.',
        })
    } finally {
      requests.delete(id)
    }
  }

  async function openFeed(token: string): Promise<void> {
    if (feed) return
    const next = new ChannelFeed(post, () => channel.close())
    feed = next
    if (await host.hub.join(next, host.host, token)) return void post({ type: 'events-open' })
    feed = undefined
    void post({ type: 'events-refused' })
  }

  const receive = (bytes: Uint8Array): void => {
    const envelope = decodeChannelMessage(bytes, channelClientMessageSchema)
    // A peer that doesn't speak this protocol has nothing to say to a Node.
    if (!envelope) return channel.close()
    const { message, body } = envelope
    if (message.type === 'request') void answer(message, body)
    else if (message.type === 'abort') requests.get(message.id)?.abort()
    else if (message.type === 'events') void openFeed(message.token)
    else if (message.type === 'frame') feed?.receive(textDecoder.decode(body))
    else if (message.type === 'ping') void post({ type: 'pong' })
    else feed?.pong()
  }

  for (let bytes = await channel.read(); bytes; bytes = await channel.read()) receive(bytes)
  feed?.closed()
  for (const controller of requests.values()) controller.abort()
}
