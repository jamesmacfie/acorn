// The one authenticated WebSocket that carries every live stream: PTY, docker, workflow and agent
// events, plus preview tunnels (docs/api-reference.md § WebSocket). One socket per node per client, on
// the loopback origin at WS_PATH, token-authenticated at upgrade.
//
// The envelope is kind-tagged and open: every frame is a plain serializable object with a stable
// string `channel`, never a live object. `channel` is `<owner>:<verb>`, the prefix before the first
// `:` is what each side registers, and everything else on the frame is the owner's shape, defined in
// its own `shared/`. Core reads only `channel` and never a payload, so a plugin adds a stream without
// touching this file.
//
// Register a channel with `ctx.events.channel(prefix, handler)` on the node (server/pluginHost/types.ts)
// and `registerWsChannel(prefix, ...)` on the client (@acorn/client-core/infra/node/wsChannels.ts).

import { z } from 'zod'

export const WS_PATH = '/v1/events'
// Symmetric event carrier ceiling, enforced by Node and custody before parsing a message.
export const MAX_NODE_WS_MESSAGE_BYTES = 8 * 1024 * 1024
// Raw preview streams use smaller messages and split arbitrary TCP chunks at both senders.
export const MAX_TUNNEL_MESSAGE_BYTES = 64 * 1024

// The index signature is load-bearing twice over: it lets an owner's frame satisfy this without a cast
// at every send site, and it suppresses excess-property checks so existing literal sends still
// typecheck unchanged.
export type WsFrame = { channel: string } & Record<string, unknown>

// The envelope stays open for plugin-owned payloads, but the channel tag is still a mutation boundary
// for term input/attach/detach (docs/security.md § Transport and auth). This validates the one field
// core dispatches on before any plugin or terminal handler sees a peer-supplied frame.
export const wsFrameSchema = z.object({ channel: z.string().min(1) }).passthrough()

// Kept as distinct names because the direction is still meaningful to a reader even though the shapes
// are now identical, and because node-core, client-core and the desktop broker each compile against
// this file unchanged.
export type WsClientFrame = WsFrame
export type WsServerFrame = WsFrame

// `seq` is per connection and stamped by the hub. It increments even for a dropped frame, so a gap
// tells a client it missed something rather than that nothing happened. That is the entire contract
// of an invalidation channel with no replay.
export type WsServerWireFrame = WsServerFrame & { seq: number }

// Optional transport ownership, advertised by GET /v1/node and requested at upgrade. Payloads remain
// channel-owned. Non-opted-in peers continue using raw frames and the original binary layout.
export const WS_VIEWERS_HEADER = 'x-acorn-viewers'
export const WS_MAX_VIEWERS = 128
export const wsViewerIdSchema = z.string().uuid()
export const wsViewerFrameSchema = z.strictObject({ channel: z.literal('ws:viewer'), viewerId: wsViewerIdSchema, frame: wsFrameSchema })
export const wsViewerCloseSchema = z.strictObject({ channel: z.literal('ws:viewer-close'), viewerId: wsViewerIdSchema })

// A channel owner declares disposable subscription state outside its opaque payload. Commands carry
// no hint and form FIFO barriers. Custody never identifies a subscription by parsing plugin frames.
export const wsSubscriptionIntentSchema = z.strictObject({ key: z.string().min(1).max(512), state: z.enum(['attached', 'detached']) })
export type WsSubscriptionIntent = z.infer<typeof wsSubscriptionIntentSchema>
export type WsSendOptions = { intent?: WsSubscriptionIntent; cleanup?: boolean }

// ── The one binary frame ──────────────────────────────────────────────────────────────────────────
//
// Everything above is JSON. Terminal output is not, because it is the one channel measured in frames
// per second: a busy build's bytes used to be JSON-escaped once per attached socket on the node and
// again on the helper hop, to carry bytes that were already bytes.
//
// The frame is an id and then the payload verbatim: `WS_BINARY_ID_BYTES` of ASCII id, then the rest.
// Fixed width rather than length-prefixed because every id this carries is a UUID, and `encodeIdFrame`
// refuses anything else so a caller falls back to its JSON frame instead of writing a frame nobody
// can read.
//
// The node tags the session id. On an opted-in events socket it adds the logical viewer id around
// that frame; the broker removes that routing layer. The helper then tags the node id around the
// unchanged session frame. Legacy Node peers always retain the original session-id layout.
//
// A binary frame carries no `seq` and consumes none. The sequence is the invalidation channel's
// gap detector (`WsServerWireFrame` above), and terminal output has never been part of it.
export const WS_BINARY_ID_BYTES = 36

export function encodeIdFrame(id: string, payload: Uint8Array): Uint8Array | null {
  if (id.length !== WS_BINARY_ID_BYTES) return null
  const frame = new Uint8Array(WS_BINARY_ID_BYTES + payload.length)
  for (let i = 0; i < WS_BINARY_ID_BYTES; i += 1) {
    const code = id.charCodeAt(i)
    if (code > 0x7f) return null // not an id this frame can spell, so the caller keeps to JSON
    frame[i] = code
  }
  frame.set(payload, WS_BINARY_ID_BYTES)
  return frame
}

export function decodeIdFrame(frame: Uint8Array): { id: string; payload: Uint8Array } | null {
  if (frame.length < WS_BINARY_ID_BYTES) return null
  let id = ''
  for (let i = 0; i < WS_BINARY_ID_BYTES; i += 1) id += String.fromCharCode(frame[i])
  return { id, payload: frame.subarray(WS_BINARY_ID_BYTES) }
}
