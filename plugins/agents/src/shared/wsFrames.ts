// Agents' WebSocket frames. @acorn/protocol keeps frame payloads `unknown`, so a product plugin keeps its
// detailed contracts in its own shared folder and adding a plugin does not invert the core->plugin
// dependency.
//
// The payloads stay `unknown` at the frame boundary on purpose: the client's managed snapshot reader
// narrows them, and re-stating those shapes here would give two places to keep in step.
export type AgentServerFrame =
  | { channel: 'agent:event'; event: unknown }
  | { channel: 'agent:session'; session: unknown }
  | { channel: 'agent:turn'; turn: unknown }
  | { channel: 'agent:request'; request: unknown }
  | { channel: 'agent:deleted'; sessionId: string }
  | { channel: 'agent:providers-changed' }
