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

// An agent asked for a plugin to be installed, updated or removed and the owner has not answered
// (docs/plugins.md § Approval-mediated install). Content-free apart from the verb: the request itself —
// including the agent's own sentence about why — is read from the device-only roster route, so nothing an
// agent wrote reaches the notification bell over the wire.
export function broadcastPluginApprovalNotice(taskId: string, action: 'install' | 'update' | 'uninstall'): void {
  wsBroadcast({
    channel: 'workflow:notice',
    notice: { taskId, kind: 'plugin-request', title: `A plugin ${action} needs your approval`, action: 'review-plugin-request' },
  })
  broadcastStatus()
}

export function broadcastWorkflowStepEvent(runId: string, stepId: string, event: unknown): void {
  wsBroadcast({ channel: 'workflow:step:event', runId, stepId, event })
}

// This node's plugin set moved under a running client: a reload swapped a plugin's node half, so its
// roster row, its routes and the bundle hash behind its UI may all be different (docs/plugins.md § The
// dev loop). Content-free, like `term:status` — the roster is already a fetchable route, and duplicating
// it on the wire would mean two projections of the same state to keep in step.
export function broadcastPluginsChanged(): void {
  wsBroadcast({ channel: 'plugins:changed' })
}
