import type { IntegrationConnectionStatus } from './integrations'

// Core events a plugin's node half may subscribe to with `ctx.events.on`
// (node-core/server/pluginHost/types.ts, docs/plugins.md § Hearing another plugin).
//
// A named list rather than "any channel", for the same reason the frame side has one
// (client-core/host/frames/channels.ts): a grant the trust prompt cannot describe is a grant the
// owner cannot consent to. Both lists are drawn from `permissions.events`, one grant vocabulary
// across the two sides of the wire.
//
// Deliberately thin. It holds what core broadcasts today, and it is the send side of
// docs/plugins.md § Hearing a core event that will grow it. Another plugin's `plugin:<id>:<verb>` is not
// here on purpose: cross-plugin subscription is item 3 of that design and needs the producer's
// `emits` declaration first.
//
// The naming, settled 2026-08-28 before the first addition made it unsettleable
// (docs/plugins.md § Hearing a core event). Two families, two contracts:
//
//   `<noun>:changed`   a node-emitted fact. "Something happened here that you may want to act on."
//                      Emitted where the write happens, delivered over the socket, heard by every
//                      client and by any plugin's node half that declared the grant. This list.
//   `runtime:*`        the shell talking to itself. "Something you were displaying is gone or moved."
//                      Renderer-local, never on the wire, and the frame-facing list in
//                      client-core/host/frames/channels.ts is where those live.
//
// A node-emitted fact reaches a frame too, so both lists name it; the split is about what the name
// promises, not about which array it sits in.
export const NODE_EVENT_CHANNELS = [
  'plugins:changed',
  'tasks:changed',
  'workspace:changed',
  'workspace-projects:changed',
  'connection:changed',
  'head:changed',
  'run:changed',
  'agent-session:changed',
  'project:changed',
  'terminal:sessions-changed',
  'worktree:status-changed',
] as const

export type NodeEventChannel = (typeof NODE_EVENT_CHANNELS)[number]

export const isNodeEventChannel = (channel: string): channel is NodeEventChannel =>
  (NODE_EVENT_CHANNELS as readonly string[]).includes(channel)

// The payload-carrying node events, and the shapes both sides read them through. Each one is state,
// not a delta: the field says what the thing now is, so a listener that missed an earlier frame still
// ends up correct (node-core/server/notify.ts says per event why it is not content-free).
export type TaskChangedEvent = { taskId: string | null }

export type WorkspaceChangedEvent = { workspaceId: string }

export type WorkspaceProjectsChangedEvent = { providerId: string; workspaceIds: string[] }

export type ConnectionChangedEvent =
  | { integrationId: string; providerId: string; status: IntegrationConnectionStatus }
  | { integrationId: string; providerId: string; deleted: true }

// A task worktree's HEAD moved: a commit, a checkout, a pull or rebase (docs/plugins.md § Hearing a core event
// § HEAD moved). `head` is the SHA the tip is at now, `dirty` whether the tree still has uncommitted
// changes, so a CI or deploy plugin can decide to act from the frame alone.
export type HeadChangedEvent = {
  projectId: string
  taskId: string
  branch: string | null
  head: string
  dirty: boolean
}

// A declared run target was started or stopped (docs/api-reference.md § WebSocket). Only the
// declared targets: generic process and port lifecycle stays off the wire
// (docs/plugins/forward-compatibility.md § What is not an event).
export type RunTargetChangedEvent = {
  taskId: string
  targetId: string
  running: boolean
}

// A managed agent session reached one of the two edges anyone outside the agents plugin has ever
// needed: it finished a turn, or it wants a person. The vocabulary is the webhook service's
// (plugins/agents/src/main/webhookService.ts), which already reduces the session firehose to exactly
// these two for external delivery; this is the same filter pointed inward.
export type AgentSessionChangedEvent = {
  taskId: string
  sessionId: string
  event: 'completion' | 'attention'
}

// A project row was created, patched, re-detected, deleted, or had its config written. The id is the
// only field: which project moved is worth a round trip saved, what moved is not.
export type ProjectChangedEvent = { projectId: string }

// Something under a task's worktree changed on this node: a stage, a commit, a discard, a push, an
// editor write, a worktree created. Carries the task rather than the path, because the path is the
// node's own filesystem and a client addresses a worktree by the task that owns it. `null` when the
// writer did not know which task it was working in, which a listener reads as "sweep them all".
//
// This is the half of the old `term:status` ping that meant "re-read the dirty markers". It is
// separate from `head:changed` because a stage or a discard moves the markers without moving HEAD.
export type WorktreeStatusChangedEvent = { taskId: string | null }
