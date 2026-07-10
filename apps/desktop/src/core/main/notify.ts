// Renderer broadcasts shared by the main-process surfaces (split out of terminal.ts). Since Phase 3
// slice 6 these ride the one authenticated WebSocket (main/wsHub.ts), not per-window IPC — a
// no-op when no socket is connected (dev:node, tests), same "no consumer → no-op" idea as before.
import { wsBroadcast } from './wsHub'

// Per-tab status (idle/exited) is shown for sessions the renderer isn't attached to, so changes
// are broadcast as a content-free ping; the panel re-pulls the session list to get fresh meta.
export function broadcastStatus(): void {
  wsBroadcast({ channel: 'term:status' })
}

// Workflow gate / run-done notices for the renderer bell (docs/next 14 P3); the memory-proposal
// gate reuses the same channel.
export function broadcastWorkflowNotice(taskId: string, kind: 'gate' | 'run-done', title: string): void {
  wsBroadcast({ channel: 'workflow:notice', notice: { taskId, kind, title } })
  broadcastStatus()
}

export function broadcastWorkflowStepEvent(runId: string, stepId: string, event: unknown): void {
  wsBroadcast({ channel: 'workflow:step:event', runId, stepId, event })
}
