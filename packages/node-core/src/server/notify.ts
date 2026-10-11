// Broadcasts from this node to its connected clients. They go over the authenticated WebSocket hub and
// do nothing when no socket is connected.
import type {
  ConnectionChangedEvent,
  HeadChangedEvent,
  ProjectChangedEvent,
  TaskChangedEvent,
  WorkspaceChangedEvent,
  WorkspaceProjectsChangedEvent,
  WorkspacesModeChangedEvent,
  WorktreeStatusChangedEvent,
} from '@acorn/protocol/nodeEvents.ts'
import type { NoticeFrame, PluginNotice } from '@acorn/protocol/notices.ts'
import { wsBroadcast } from './transport/wsHub'
import { clearDashboardReadCache } from './dashboards/readCache'
import { clearSourceIdentity } from './dataSources/identityCache'

// "Re-read this plugin's chrome descriptors": rail rows, badges, sources, agent context. One
// client-side consumer, `bumpChrome` in client-core, and nothing else hears it.
//
// Pass the plugin id. Without it every connected client refetches every plugin's descriptor routes;
// with it, a plugin saying "my rows moved" costs one plugin's rows. Core's own pings pass nothing,
// because a task create or a worktree appearing can move anyone's, and they happen at human speed.
//
// The channel keeps its `term:` name for wire compatibility. Terminal and worktree changes have their
// own channels below.
export function broadcastStatus(pluginId?: string): void {
  wsBroadcast(pluginId ? { channel: 'term:status', pluginId } : { channel: 'term:status' })
}

// Something under a task's worktree changed (@acorn/protocol/nodeEvents.ts). Fired where the write
// happens rather than wherever a terminal happened to go quiet.
export function broadcastWorktreeStatusChanged(event: WorktreeStatusChangedEvent): void {
  wsBroadcast({ channel: 'worktree:status-changed', ...event })
}

// A bell row, from whichever plugin raised it (@acorn/protocol/notices.ts). Reached through
// `ctx.events.notice` rather than imported, and the tier rules are applied there: a loaded plugin
// names no target and cannot pick its own kind.
//
// `pluginId` is stamped here from the caller the host bound, never taken from the payload. It is what
// lets the client answer "where does this row go" for a plugin that named nothing.
//
// The chrome bump is scoped to the raiser: the rows a notice can have moved are the raiser's, and an
// unscoped bump would cost every other plugin a descriptor round trip on every connected client.
export function broadcastNotice(pluginId: string, notice: PluginNotice): void {
  wsBroadcast({ channel: 'workflow:notice', notice: { ...notice, pluginId } satisfies NoticeFrame })
  broadcastStatus(pluginId)
}

export function broadcastRepoConfigTrustNotice(taskId: string): void {
  wsBroadcast({
    channel: 'workflow:notice',
    notice: { taskId, kind: 'repo-config-trust', title: 'Repo configuration needs review', action: 'review-config' },
  })
  broadcastStatus()
}

// An agent asked for a plugin install, update, or removal and the owner has not answered
// (docs/plugins/agent-install.md § Approval-mediated install). Content-free apart from the verb: the request, and
// the agent's own sentence about why, come from the device-only roster route, so nothing an agent
// wrote reaches the bell over the wire.
export function broadcastPluginApprovalNotice(taskId: string, action: 'install' | 'update' | 'uninstall'): void {
  wsBroadcast({
    channel: 'workflow:notice',
    notice: {
      taskId,
      kind: 'plugin-request',
      title: `A plugin ${action} needs your approval`,
      action: 'review-plugin-request',
    },
  })
  broadcastStatus()
}

// This node's plugin set moved under a running client. A reload swapped a plugin's node half, so its
// roster row, its routes, and the bundle hash behind its UI may all differ (docs/plugins/dev-loop.md § The
// dev loop). Content-free, like `term:status`: the roster is a fetchable route, and putting it on
// the wire too would mean two projections of the same state to keep in step.
export function broadcastPluginsChanged(): void {
  clearDashboardReadCache()
  wsBroadcast({ channel: 'plugins:changed' })
}

// A task was created, patched, archived, cancelled or had its links change. The id makes this an
// addressable invalidation for consumers that can read one task; `null` is the explicit escape hatch
// for batch writes such as a project deletion or pull-number adoption.
//
// It is `tasks:changed` rather than another `term:status` ping because a client has to be able to tell
// "the task list moved" from "a terminal's status moved" — the first invalidates a query, the second
// re-pulls a session list — and because a plugin's node half can subscribe to this one by name
// (@acorn/protocol/nodeEvents.ts). Without it a second client keeps a stale task list until it
// reconnects (docs/plugins/events.md § Hearing a core event).
export function broadcastTasksChanged(event: TaskChangedEvent): void {
  wsBroadcast({ channel: 'tasks:changed', ...event })
}

// Workspace identity and external-project membership are separate read models. A workspace frame
// invalidates the roster; a mapping frame says which scopes to re-read and which provider can ignore
// the event. Keeping them separate avoids making a rename invalidate every provider mapping.
export function broadcastWorkspaceChanged(event: WorkspaceChangedEvent): void {
  wsBroadcast({ channel: 'workspace:changed', ...event })
}

// Grouping changes the rules and wording for every workspace without changing a workspace row.
export function broadcastWorkspacesModeChanged(event: WorkspacesModeChangedEvent): void {
  wsBroadcast({ channel: 'workspaces-mode:changed', ...event })
}

export function broadcastWorkspaceProjectsChanged(event: WorkspaceProjectsChangedEvent): void {
  wsBroadcast({ channel: 'workspace-projects:changed', ...event })
}

// A connection was made, rotated, tested, disabled, re-enabled, or demoted to `needs-auth` because its
// credential could not be read (docs/plugins/events.md § Hearing a core event).
//
// This one carries a payload where the other three are content-free, and the difference is who the
// audience is. The built-in `tasks:changed` consumer always re-reads the whole list. A revoked
// credential is heard by every integration plugin on the node, and almost all of them are looking at a
// different provider. Three fields let a listener drop the frame without a round trip.
//
// It is still state rather than a delta, which is what the envelope requires (@acorn/protocol/ws.ts):
// `status` is what the row now says, not what changed about it, so a client that missed a frame is not
// left holding a gap. Everything else about the connection stays a fetchable route.
export function broadcastConnectionChanged(connection: ConnectionChangedEvent): void {
  clearDashboardReadCache()
  clearSourceIdentity(connection.integrationId)
  wsBroadcast({ channel: 'connection:changed', ...connection })
}

// A task worktree's HEAD moved (docs/plugins/events.md § Hearing a core event). Detected by
// `computeTaskStatuses`, which runs `git status` for every active worktree and reads the branch tip
// too, so a commit made from a terminal, an agent, or an outside editor is noticed the same way one
// made from the changes pane is. Carries a payload because the audience is CI,
// deploy and scan plugins that act on the SHA itself rather than re-reading a list.
export function broadcastHeadChanged(event: HeadChangedEvent): void {
  wsBroadcast({ channel: 'head:changed', ...event })
}

// A project row or its config moved (docs/api-reference/websocket.md § WebSocket). Preview reads its URL
// mode, terminal reads run targets, and changes reads the branch prefix.
export function broadcastProjectChanged(event: ProjectChangedEvent): void {
  wsBroadcast({ channel: 'project:changed', ...event })
}
