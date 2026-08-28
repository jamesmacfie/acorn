// Renderer broadcasts shared by the main-process surfaces. They go over the authenticated WebSocket
// hub and do nothing when no socket is connected.
import type { AgentSessionChangedEvent, ConnectionChangedEvent, HeadChangedEvent, ProjectChangedEvent, RunTargetChangedEvent } from '@acorn/protocol/nodeEvents.ts'
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
// reconnected (docs/plugins.md § Hearing a core event).
export function broadcastTasksChanged(): void {
  wsBroadcast({ channel: 'tasks:changed' })
}

// A connection was made, rotated, tested, disabled, re-enabled, or demoted to `needs-auth` because its
// credential could not be read. Nine writers spread over four files change that status, and until this
// existed none of them said so: a client refetched on suspicion and an integration plugin found out
// from the next 401 (docs/plugins.md § Hearing a core event).
//
// This one carries a payload where the other three are content-free, and the difference is who the
// audience is. `tasks:changed` has one consumer that always re-reads the whole list. A revoked
// credential is heard by every integration plugin on the node, and almost all of them are looking at a
// different provider. Three fields let a listener drop the frame without a round trip.
//
// It is still state rather than a delta, which is what the envelope requires (@acorn/protocol/ws.ts):
// `status` is what the row now says, not what changed about it, so a client that missed a frame is not
// left holding a gap. Everything else about the connection stays a fetchable route.
export function broadcastConnectionChanged(connection: ConnectionChangedEvent): void {
  wsBroadcast({ channel: 'connection:changed', ...connection })
}

// A task worktree's HEAD moved (docs/plugins.md § Hearing a core event). Detected by
// computeTaskStatuses (main/taskWorktree.ts), which already runs `git status` for every active worktree
// and now reads the branch tip too, so a commit made from a terminal, an agent, or an outside editor is
// noticed the same way one made from the changes pane is. Carries a payload because the audience is CI,
// deploy and scan plugins that act on the SHA itself rather than re-reading a list.
export function broadcastHeadChanged(event: HeadChangedEvent): void {
  wsBroadcast({ channel: 'head:changed', ...event })
}

// A declared run target started or stopped (core-events.md § Run target state). Emitted by the terminal
// plugin, which holds the process, through `ctx.events.send`; this helper is the core-side twin so the
// two never spell the frame differently.
export function broadcastRunTargetChanged(event: RunTargetChangedEvent): void {
  wsBroadcast({ channel: 'run:changed', ...event })
}

// A managed agent session finished a turn or asked for attention (core-events.md § Agent session
// state). Same two kinds as the agents webhook service, on purpose: there is one reduction of the
// session stream to human-scale edges, and it is deployed.
export function broadcastAgentSessionChanged(event: AgentSessionChangedEvent): void {
  wsBroadcast({ channel: 'agent-session:changed', ...event })
}

// A project row or its config moved (core-events.md § Project changed). Preview reads browser rules
// and the preview mode, terminal reads run targets, changes reads the branch prefix, and until this
// existed none of them heard a write; onboarding hand-invalidated its own cache after creating one.
export function broadcastProjectChanged(event: ProjectChangedEvent): void {
  wsBroadcast({ channel: 'project:changed', ...event })
}
