// Agents' WebSocket frames. The payloads were already `unknown` in @acorn/protocol/ws.ts, with a
// comment saying product plugins keep their detailed contracts in their own shared folders so that
// adding a plugin does not invert the core->plugin dependency. That was right, and the open envelope
// (finding 2) lets the channel names come here too.
//
// The payloads stay `unknown` at the frame boundary on purpose: managedSnapshot.ts narrows them, and
// re-stating those shapes here would give two places to keep in step.
export type AgentServerFrame =
  | { channel: 'agent:event'; event: unknown }
  | { channel: 'agent:session'; session: unknown }
  | { channel: 'agent:deleted'; sessionId: string }
