import type { Disposable } from './capabilities.js'

// ── Broadcasts ────────────────────────────────────────────────────────────────────────────────────

/** Telling connected clients something changed, and hearing that something changed on this node.
 *
 * A broadcast is an invalidation channel, not an event log: no durability, no replay, no delivery
 * guarantee. A client that misses one refetches after the gap. Send "go re-read", not state. */
export type PluginBroadcast = {
  /** Confined to your own `plugin:<yourId>:<verb>` namespace. Anything else throws. */
  send(frame: { channel: string } & Record<string, unknown>): void
  /** "Re-read my chrome descriptors": your rail rows, badges, sources and agent context. Scoped to
   *  your plugin, so it costs nobody else a round trip. */
  status(): void
  /** "Something under this task's worktree changed": a stage, a commit, a discard, a file written. The
   *  dirty markers in the rail and footer come from a `git status` sweep, and this is what tells a
   *  client to take it. `null` when you do not know the task. */
  worktreeStatus(taskId: string | null): void
  /** "This repo's committed config changed and needs the owner's review." */
  repoConfigTrustNotice(taskId: string): void
  /** Raise a row in the owner's notification bell.
   *
   *  `taskId` is optional: leave it off for something that is about the node rather than one task, such
   *  as a connection that expired. Clicking the row opens your plugin's own rail source, or the
   *  Settings page listing your plugin if you contribute no source.
   *
   *  Two fields you can pass are ignored for a plugin loaded from disk. `target` is dropped, because
   *  naming one means naming another plugin's handler and any resource in it. `kind` is dropped, so the
   *  row draws as a plugin row and stays in the bell instead of reaching the desktop. */
  notice(notice: PluginNotice): void
  /** Hear a core event, or another plugin's declared verb, on this node, whether or not a client is
   *  attached. The event must be one your manifest named in `permissions.events`. Another plugin's
   *  `plugin:<id>:<verb>` works when that plugin lists the verb in its manifest's `emits`; if it is not
   *  installed you hear nothing and no error. Disposal follows unload. */
  on(event: NodeEventChannel | `plugin:${string}:${string}`, listener: (frame: { channel: string } & Record<string, unknown>) => void): Disposable
}

/** A bell row you raise with `events.notice`.
 *
 * `target` and `kind` are honoured for a plugin compiled into acorn and dropped for one loaded from
 * disk, which gets its own rail source instead. */
export type PluginNotice = {
  taskId?: string
  title: string
  detail?: string
  kind?: string
  target?: { kind: string; resourceId: string; subresourceId?: string }
}

/** Core events a node half may subscribe to. Each frame's fields are in `@acorn/protocol/nodeEvents.ts`. */
export type NodeEventChannel =
  | 'plugins:changed'
  | 'tasks:changed'
  | 'workspace:changed'
  | 'workspace-projects:changed'
  | 'connection:changed'
  | 'head:changed'
  | 'run:changed'
  | 'agent-session:changed'
  | 'project:changed'
  | 'terminal:sessions-changed'
  | 'worktree:status-changed'
