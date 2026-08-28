// Renderer broadcasts shared by the main-process surfaces. They go over the authenticated WebSocket
// hub and do nothing when no socket is connected.
import { wsBroadcast } from './wsHub'

// Per-tab status is shown for sessions the renderer is not attached to, so a change broadcasts as a
// content-free ping and the panel re-pulls the session list.
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

// An agent asked for a plugin install, update, or removal and the owner has not answered
// (docs/plugins.md § Approval-mediated install). Content-free apart from the verb: the request, and
// the agent's own sentence about why, come from the device-only roster route, so nothing an agent
// wrote reaches the bell over the wire.
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

// This node's plugin set moved under a running client. A reload swapped a plugin's node half, so its
// roster row, its routes, and the bundle hash behind its UI may all differ (docs/plugins.md § The
// dev loop). Content-free, like `term:status`: the roster is a fetchable route, and putting it on
// the wire too would mean two projections of the same state to keep in step.
export function broadcastPluginsChanged(): void {
  wsBroadcast({ channel: 'plugins:changed' })
}

// A task was created, patched, archived, cancelled or had its links change. Content-free for the same
// reason as the two above: the task list is a fetchable route, and a payload would be a second
// projection to keep in step.
//
// It is `tasks:changed` rather than another `term:status` ping because a client has to be able to tell
// "the task list moved" from "a terminal's status moved" — the first invalidates a query, the second
// re-pulls a session list — and because a plugin's node half can subscribe to this one by name
// (@acorn/protocol/nodeEvents.ts). Without it a second client kept a stale task list until it
// reconnected (docs/future/events/delivery.md defect 1).
export function broadcastTasksChanged(): void {
  wsBroadcast({ channel: 'tasks:changed' })
}
