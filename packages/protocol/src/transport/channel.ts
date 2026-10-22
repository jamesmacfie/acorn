import { z } from 'zod'

// What crosses a phone's encrypted channel to a Node (docs/relay/phone-channel.md). Each message is a JSON
// header, plus bytes for the three that carry a body. The shapes are a request and its answer, and the event
// socket's frames in both directions.

// A request, an answer, or a terminal frame can hold a 16 MiB body, the limit the desktop helper puts
// on one request, plus its header.
export const CHANNEL_MAX_MESSAGE_BYTES = 17 * 1024 * 1024
// The handshake and the first message after it have this long, so a stream that never speaks can't hold
// one of the relay's 256 stream slots.
export const CHANNEL_HANDSHAKE_TIMEOUT_MS = 10_000
// Each side pings after this much silence, and treats a missed answer as a dead channel.
export const CHANNEL_PING_INTERVAL_MS = 15_000

const requestId = z.string().min(1).max(128)

// From the phone. A request carries the same fields as the broker's `NodeFetchRequest`, with the body
// as the message's bytes. The device token rides in `authorization`, as it does on a native client.
const requestMessage = z.strictObject({
  type: z.literal('request'),
  id: requestId,
  method: z.string().min(1).max(16),
  path: z.string().startsWith('/').max(8192),
  headers: z.record(z.string(), z.string()),
})
// The phone gave up on a request.
const abortMessage = z.strictObject({ type: z.literal('abort'), id: requestId })
// Opens the event feed for this device token. The Node answers `events-open`, or `events-refused` when
// the token isn't a live device's.
const eventsMessage = z.strictObject({ type: z.literal('events'), token: z.string().min(1).max(512) })
// A client frame for the event feed. The bytes are the frame's JSON, as `WsClientFrame`, which the Node's
// hub reads as it reads a socket's text message.
const frameMessage = z.strictObject({ type: z.literal('frame') })
const pingMessage = z.strictObject({ type: z.literal('ping') })
const pongMessage = z.strictObject({ type: z.literal('pong') })

export const channelClientMessageSchema = z.discriminatedUnion('type', [
  requestMessage,
  abortMessage,
  eventsMessage,
  frameMessage,
  pingMessage,
  pongMessage,
])
export type ChannelClientMessage = z.infer<typeof channelClientMessageSchema>

// From the Node. Objects stay open, because a phone ignores what it doesn't know.
const responseMessage = z.object({
  type: z.literal('response'),
  id: requestId,
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
})
// The request failed before the Node's router answered it.
const failureMessage = z.object({
  type: z.literal('failure'),
  id: requestId,
  code: z.enum(['bad_request', 'response_too_large', 'unreachable']),
  message: z.string(),
})
const eventsOpenMessage = z.object({ type: z.literal('events-open') })
const eventsRefusedMessage = z.object({ type: z.literal('events-refused') })
// One event feed frame. The bytes are its JSON as the hub wrote it, `seq` included.
const nodeFrameMessage = z.object({ type: z.literal('frame') })
// Terminal output: the hub's one binary frame, in the message's bytes.
const bytesMessage = z.object({ type: z.literal('bytes') })

export const channelNodeMessageSchema = z.discriminatedUnion('type', [
  responseMessage,
  failureMessage,
  eventsOpenMessage,
  eventsRefusedMessage,
  nodeFrameMessage,
  bytesMessage,
  pingMessage,
  pongMessage,
])
export type ChannelNodeMessage = z.infer<typeof channelNodeMessageSchema>

export type ChannelEnvelope<Message> = { message: Message; body: Uint8Array }

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const LENGTH_BYTES = 4

// A message on the wire: four bytes of header length, the header as JSON, then the body.
export function encodeChannelMessage(
  message: ChannelClientMessage | ChannelNodeMessage,
  body?: Uint8Array,
): Uint8Array {
  const header = textEncoder.encode(JSON.stringify(message))
  const bodyLength = body?.byteLength ?? 0
  const out = new Uint8Array(LENGTH_BYTES + header.byteLength + bodyLength)
  new DataView(out.buffer).setUint32(0, header.byteLength)
  out.set(header, LENGTH_BYTES)
  if (body) out.set(body, LENGTH_BYTES + header.byteLength)
  return out
}

// The header and body of one message, or null when the bytes aren't a message of this protocol.
export function decodeChannelMessage<Message>(
  bytes: Uint8Array,
  schema: z.ZodType<Message>,
): ChannelEnvelope<Message> | null {
  if (bytes.byteLength < LENGTH_BYTES) return null
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  const bodyStart = LENGTH_BYTES + headerLength
  if (bodyStart > bytes.byteLength) return null
  try {
    const message = schema.safeParse(JSON.parse(textDecoder.decode(bytes.subarray(LENGTH_BYTES, bodyStart))))
    return message.success ? { message: message.data, body: bytes.subarray(bodyStart) } : null
  } catch {
    return null
  }
}
