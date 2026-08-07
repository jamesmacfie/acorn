// The one authenticated WebSocket that carries every live stream (docs/electron.md § capability map):
// terminal PTY output/input + attach/detach, session-status pings, workflow notices and step events,
// agent events, and docker log/stat/exec streams. One socket on the loopback origin at WS_PATH.
//
// Framing is kind-tagged channels (docs/security.md § seams): every frame is a plain serializable
// object with a stable string `channel` — never a live object.
//
// THE ENVELOPE IS OPEN, and that is the point. This file used to be a discriminated union enumerating
// every channel, including eleven docker-specific ones, and it imported a docker type and a terminal
// type from inside protocol to do it. A plugin with a new stream could not exist without editing two
// core packages. Now core owns the envelope and nothing else: `channel` is `<owner>:<verb>`, the token
// before the first ':' is the registered prefix on both ends, and everything else on the frame belongs
// to the channel's owner, whose own union lives in its `shared/`.
//
// This generalizes what agents already did deliberately — it carried `event: unknown` with a comment
// saying product plugins keep their detailed contracts in their own shared folders, so that adding a
// plugin does not invert the core→plugin dependency. That was right for one plugin and is right for
// all of them.
//
// Registration: `ctx.events.channel(prefix, handler)` on the node (server/plugin/types.ts),
// `registerWsChannel(prefix, ...)` on the client (@acorn/client-core/wsChannels.ts). Core never reads
// a payload, so adding a stream is now a plugin-local change.

// docs/api-reference.md § Events: one WS per node per client, token-authenticated at upgrade.
export const WS_PATH = '/v2/events'

// The index signature is load-bearing twice over: it lets an owner's frame satisfy this without a cast
// at every send site, and it suppresses excess-property checks so existing literal sends still
// typecheck unchanged.
export type WsFrame = { channel: string } & Record<string, unknown>

// Kept as distinct names because the DIRECTION is still meaningful to a reader even though the shapes
// are now identical, and because it means node-core, client-core and the desktop broker compile
// against this file with no diff at all.
export type WsClientFrame = WsFrame
export type WsServerFrame = WsFrame

// `seq` is per connection and stamped by the hub. It increments even for a dropped frame, so a gap in
// the sequence tells a client it missed something rather than that nothing happened — which is the
// whole contract of an invalidation channel offering no replay.
export type WsServerWireFrame = WsServerFrame & { seq: number }
