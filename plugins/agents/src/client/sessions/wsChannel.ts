// Agents' half of the WebSocket. Core routes on the `agent` prefix and never looks inside a frame.
import { registerWsChannel, wsConnect } from '@acorn/plugin-api/client'
import type { AgentServerFrame } from '../../shared/wsFrames'

type AgentFrameCb = (frame: AgentServerFrame) => void

const agentFrameSubs = new Set<AgentFrameCb>()
let channel: ReturnType<typeof registerWsChannel> | null = null

// No reattach hook: agent frames are pushed, never subscribed to per id, so there is nothing to restore
// after a reconnect. A shown conversation (`AgentConversation`) reads on from its held events on the
// reconnect signal instead.
// Subscribe to every agent frame; returns an unsubscribe.
export function wsOnAgentFrame(cb: AgentFrameCb): () => void {
  // Loading a lazy surface must not claim transport. A dev module can be evaluated again while
  // the running plugin still owns its channel; only an active subscription owns that lifetime.
  channel ??= registerWsChannel('agent', (frame) => agentFrameSubs.forEach((cb) => cb(frame as AgentServerFrame)))
  agentFrameSubs.add(cb)
  wsConnect()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    agentFrameSubs.delete(cb)
    if (agentFrameSubs.size) return
    channel?.dispose()
    channel = null
  }
}
