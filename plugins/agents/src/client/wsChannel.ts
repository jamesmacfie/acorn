// Agents' half of the WebSocket, moved out of @acorn/client-core/wsClient.ts with the open envelope
// (finding 2). Core routes on the `agent` prefix and never looks inside a frame.
import { registerWsChannel } from '@acorn/client-core/wsChannels.ts'
import { wsConnect } from '@acorn/client-core/wsClient.ts'
import type { AgentServerFrame } from '../shared/wsFrames'

type AgentFrameCb = (frame: AgentServerFrame) => void

const agentFrameSubs = new Set<AgentFrameCb>()

// No reattach hook: agent frames are pushed, never subscribed to per id, so there is nothing to
// restore after a reconnect — the store refetches on the reconnect signal instead.
registerWsChannel('agent', (frame) => agentFrameSubs.forEach((cb) => cb(frame as AgentServerFrame)))

// Subscribe to every agent frame; returns an unsubscribe.
export function wsOnAgentFrame(cb: AgentFrameCb): () => void {
  agentFrameSubs.add(cb)
  wsConnect()
  return () => void agentFrameSubs.delete(cb)
}

// Test seam: the set is a module singleton, and core's _resetWsClient no longer knows about it.
export const _resetAgentWsChannel = (): void => agentFrameSubs.clear()
