// Core events a plugin's node half may subscribe to with `ctx.events.on`
// (node-core/server/plugin/types.ts, docs/future/events/subscriptions.md item 1).
//
// A named list rather than "any channel", for the same reason the frame side has one
// (client-core/plugins/frames/channels.ts): a grant the trust prompt cannot describe is a grant the
// owner cannot consent to. Both lists are drawn from `permissions.events`, one grant vocabulary
// across the two sides of the wire.
//
// Deliberately thin. It holds what core broadcasts today, and it is the send side of
// docs/future/events/core-events.md that will grow it. Another plugin's `plugin:<id>:<verb>` is not
// here on purpose: cross-plugin subscription is item 3 of that design and needs the producer's
// `emits` declaration first.
//
// The naming, settled 2026-08-28 before the first addition made it unsettleable
// (docs/future/events/delivery.md § The naming problem). Two families, two contracts:
//
//   `<noun>:changed`   a node-emitted fact. "Something happened here that you may want to act on."
//                      Emitted where the write happens, delivered over the socket, heard by every
//                      client and by any plugin's node half that declared the grant. This list.
//   `runtime:*`        the shell talking to itself. "Something you were displaying is gone or moved."
//                      Renderer-local, never on the wire, and the frame-facing list in
//                      client-core/plugins/frames/channels.ts is where those live.
//
// A node-emitted fact reaches a frame too, so both lists name it; the split is about what the name
// promises, not about which array it sits in.
export const NODE_EVENT_CHANNELS = ['plugins:changed', 'tasks:changed'] as const

export type NodeEventChannel = (typeof NODE_EVENT_CHANNELS)[number]

export const isNodeEventChannel = (channel: string): channel is NodeEventChannel =>
  (NODE_EVENT_CHANNELS as readonly string[]).includes(channel)
