// Renderer broadcasts shared by the main-process surfaces. They use the authenticated WebSocket hub
// rather than per-window IPC and are no-ops when no socket is connected.
import { wsBroadcast } from './wsHub'

// Per-tab status (idle/exited) is shown for sessions the renderer isn't attached to, so changes
// are broadcast as a content-free ping; the panel re-pulls the session list to get fresh meta.
export function broadcastStatus(): void {
  wsBroadcast({ channel: 'term:status' })
}

// Workflow gate / run-done notices for the renderer bell (docs/workflows.md); the memory-proposal
// gate reuses the same channel.
export function broadcastWorkflowNotice(taskId: string, kind: 'gate' | 'run-done', title: string): void {
  wsBroadcast({ channel: 'workflow:notice', notice: { taskId, kind, title } })
  broadcastStatus()
}

export function broadcastRepoConfigTrustNotice(taskId: string): void {
  wsBroadcast({
    channel: 'workflow:notice',
    notice: { taskId, kind: 'repo-config-trust', title: 'Repo configuration needs review', action: 'review-config' },
  })
  broadcastStatus()
}

export function broadcastWorkflowStepEvent(runId: string, stepId: string, event: unknown): void {
  wsBroadcast({ channel: 'workflow:step:event', runId, stepId, event })
}
