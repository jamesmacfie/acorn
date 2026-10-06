// The `agents:before-permission` hook: its declaration and what a policy plugin reads
// (docs/managed-agents/permission-policy.md).

/**
 * What the harness asked to do, as its own protocol described it. Every field is present on every
 * call and empty when the harness sent nothing, because hook payload matching is exact. Nothing here is
 * rebuilt from display text: a command the harness didn't send is `''`, not a guess from the card title.
 */
export type AgentPermissionSubject = {
  /** The harness's own id for the tool call, `''` when it sent none. */
  toolCallId: string
  kind: 'command' | 'edit' | 'read' | 'fetch' | 'permissions' | 'other'
  /** The command line, when the harness sent one as a string. */
  command: string
  /** The paths the call touches, when the harness named them. A Codex command adds its working directory. */
  paths: string[]
}

/** The `agents:before-permission` payload: the subject, and where it was asked. */
export type AgentBeforePermissionPayload = AgentPermissionSubject & {
  sessionId: string
  taskId: string
  /** The parked provider request's id, scoped to the session. The same id `agents.requests` reports. */
  requestId: string
  providerId: string
  /** True for workflow and delegated sessions, where nobody is watching the card. */
  unattended: boolean
  /** The harness's own summary, as the card shows it. */
  title: string
  /** The task's worktree root, `''` when it couldn't be read. */
  root: string
}

/** The point's declaration. Its payload shape is the type above, field for field. */
export const BEFORE_PERMISSION_HOOK = {
  id: 'before-permission',
  // The decision, in the words the trust prompt's hook sentences expect: "Stop agents from doing “…”"
  // for a veto, "Watch agents's “…” decision" for an observer, who sees every command and path asked
  // about. Those sentences quote the handler's own extension label, so a handler should reuse this one.
  label: 'run a tool the agent asks permission for',
  payload: {
    sessionId: 'string',
    taskId: 'string',
    requestId: 'string',
    providerId: 'string',
    unattended: 'boolean',
    title: 'string',
    root: 'string',
    toolCallId: 'string',
    kind: 'string',
    command: 'string',
    paths: 'string[]',
  },
  allows: ['observe', 'veto'],
  timeoutMs: 5_000,
  // No objection, so the request goes on to the person. A stalled handler costs a few seconds before
  // the card appears and never an approval nobody gave.
  onTimeout: 'allow',
  order: 'install',
} as const
