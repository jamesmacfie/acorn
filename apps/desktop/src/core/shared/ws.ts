// The one authenticated WebSocket that carries every live stream (docs/electron.md §12):
// terminal PTY output/input + attach/detach, session-status pings, workflow notices, and (reserved,
// wired but unpopulated) workflow step events. One socket on the loopback origin at WS_PATH.
//
// Framing is kind-tagged channels (security.md §9 seams 2–3): every frame is a plain serializable
// object with a stable string `channel` — never a live object — so a future `events` channel is
// additive and an authorized external client stays forward-compatible.
import type { ServerMsg } from './terminal'

export const WS_PATH = '/ws'

// Renderer → server. Keystrokes into a PTY and attach/detach (subscribe + ring replay); plus the
// UI-control-broker registration/state/result frames (docs/next/api/commands-and-ui.md §4).
export type WsClientFrame =
  | { channel: 'term:input'; id: string; data: string }
  | { channel: 'term:attach'; id: string }
  | { channel: 'term:detach'; id: string }
  | { channel: 'ui:register'; windowId: string; primary: boolean; snapshot: unknown }
  | { channel: 'ui:state'; windowId: string; snapshot: unknown }
  | { channel: 'ui:command-result'; requestId: string; ok: true; result: unknown; revision: number }
  | { channel: 'ui:command-result'; requestId: string; ok: false; error: { code: string; message: string; details?: unknown }; revision: number }

// Server → renderer. `term:out` wraps the existing per-session ServerMsg (ready/output/exit); the
// two pings carry the same payloads the old IPC pushes did. workflow:step:event is reserved.
export type WsServerFrame =
  | { channel: 'term:out'; id: string; msg: ServerMsg }
  | { channel: 'term:status' }
  | { channel: 'workflow:notice'; notice: { taskId: string; kind: 'gate' | 'run-done' | 'repo-config-trust'; title: string; action?: 'review-config' } }
  | { channel: 'workflow:step:event'; runId: string; stepId: string; event: unknown }
  | { channel: 'ui:command'; requestId: string; windowId: string; commandId: string; input: unknown; expectedRevision?: number }
