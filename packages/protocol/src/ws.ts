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
// Register a channel with `ctx.events.channel(prefix, handler)` on the node (server/plugin/types.ts)
// and `registerWsChannel(prefix, ...)` on the client (@acorn/client-core/wsChannels.ts).

import { z } from 'zod'

export const WS_PATH = '/v2/events'

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
