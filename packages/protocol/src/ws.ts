// The one authenticated WebSocket that carries every live stream (docs/electron.md §12):
// terminal PTY output/input + attach/detach, session-status pings, workflow notices, and (reserved,
// wired but unpopulated) workflow step events. One socket on the loopback origin at WS_PATH.
//
// Framing is kind-tagged channels (security.md §9 seams 2–3): every frame is a plain serializable
// object with a stable string `channel` — never a live object — so a future `events` channel is
// additive and an authorized external client stays forward-compatible.
import type { ServerMsg } from './terminal'
import type { DockerStatsSample } from './docker'

// docs/api-reference.md § Events: one WS per node per client, token-authenticated at upgrade.
export const WS_PATH = '/v2/events'

// Renderer → server. Keystrokes into a PTY and attach/detach (subscribe + screen restore).
export type WsClientFrame =
  | { channel: 'term:input'; id: string; data: string }
  | { channel: 'term:attach'; id: string }
  | { channel: 'term:detach'; id: string }
  | { channel: 'docker:logs:attach'; id: string }
  | { channel: 'docker:logs:detach'; id: string }
  | { channel: 'docker:stats:attach'; id: string }
  | { channel: 'docker:stats:detach'; id: string }
  | { channel: 'docker:exec:open'; execId: string; ref: string; cols: number; rows: number }
  | { channel: 'docker:exec:in'; execId: string; data: string }
  | { channel: 'docker:exec:resize'; execId: string; cols: number; rows: number }
  | { channel: 'docker:exec:kill'; execId: string }

// Server → renderer. `term:out` wraps the per-session ServerMsg (ready/output/exit); status and
// workflow frames carry serializable event payloads.
// docker:changed is the docker plugin's cache-dirty ping (scopes: containers/images/volumes/networks).
export type WsServerFrame =
  | { channel: 'term:out'; id: string; msg: ServerMsg }
  | { channel: 'term:status' }
  | { channel: 'docker:changed'; scopes: string[] }
  | { channel: 'docker:log'; id: string; data: string }
  | { channel: 'docker:stats'; id: string; sample: DockerStatsSample }
  | { channel: 'docker:stream-end'; id: string; kind: 'logs' | 'stats' }
  | { channel: 'docker:exec:out'; execId: string; data: string }
  | { channel: 'docker:exec:exit'; execId: string }
  | { channel: 'workflow:notice'; notice: { taskId: string; kind: 'gate' | 'run-done' | 'repo-config-trust'; title: string; action?: 'review-config' } }
  | { channel: 'workflow:step:event'; runId: string; stepId: string; event: unknown }
  // Product plugins keep their detailed contracts in their own shared folders. Core owns only
  // the transport envelope, so adding Agents does not invert the core → plugin dependency.
  | { channel: 'agent:event'; event: unknown }
  | { channel: 'agent:session'; session: unknown }
  | { channel: 'agent:deleted'; sessionId: string }

export type WsServerWireFrame = WsServerFrame & { seq: number }
