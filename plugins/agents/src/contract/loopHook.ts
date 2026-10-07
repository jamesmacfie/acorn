// Harness bridges: the two points a bridged harness runs on every tool call, and the shape its bridge
// posts (docs/managed-agents/loop-hooks.md).
import type { AgentPermissionSubject } from './permissionHook.ts'

/** The `agents:before-tool` payload. The subject is `agents:before-permission`'s, so one policy
 *  handler can serve both points. */
export type AgentBeforeToolPayload = AgentPermissionSubject & {
  sessionId: string
  taskId: string
  providerId: string
  /** True for workflow and delegated sessions, where nobody is watching. */
  unattended: boolean
  /** The task's worktree root, `''` when it couldn't be read. */
  root: string
  /** The harness's own tool name, such as `Bash`. */
  toolName: string
  /** A short summary: the command, the first path, or the tool name. */
  title: string
}

/** The `agents:after-tool` payload. A transform may set `note`, which the model reads beside the
 *  tool's result. Everything else it changes is ignored. */
export type AgentAfterToolPayload = AgentBeforeToolPayload & {
  succeeded: boolean
  /** Starts empty. Bounded to `LOOP_NOTE_MAX` characters on the way back. */
  note: string
}

const SUBJECT = {
  sessionId: 'string',
  taskId: 'string',
  providerId: 'string',
  unattended: 'boolean',
  root: 'string',
  toolCallId: 'string',
  toolName: 'string',
  kind: 'string',
  title: 'string',
  command: 'string',
  paths: 'string[]',
} as const

/** Before a bridged harness runs any tool. A veto denies the call with its reason, which the model
 *  reads in the same turn. An ask holds the call on a permission card. Nothing here approves a call. */
export const BEFORE_TOOL_HOOK = {
  id: 'before-tool',
  // Quoted by the trust prompt: "Stop agents from doing “run any tool”".
  label: 'run any tool',
  payload: SUBJECT,
  allows: ['observe', 'veto', 'ask'],
  timeoutMs: 5_000,
  // No objection, so the harness's own checks decide, as they would with no bridge at all.
  onTimeout: 'allow',
  order: 'install',
} as const

/** After a bridged harness ran a tool. A transform's `note` reaches the model inside the turn. */
export const AFTER_TOOL_HOOK = {
  id: 'after-tool',
  // Quoted by the trust prompt: "Change how agents will “read a tool result”".
  label: 'read a tool result',
  payload: { ...SUBJECT, succeeded: 'boolean', note: 'string' },
  allows: ['observe', 'transform'],
  timeoutMs: 5_000,
  onTimeout: 'allow',
  order: 'install',
} as const

/** The most of a note the model is handed. */
export const LOOP_NOTE_MAX = 4_096

export const LOOP_HOOK_VERSION = 'agents.loopHook.v1'

/** Where the bridge posts. The installed command names it, so the bridge program names no plugin. */
export const LOOP_HOOK_ROUTE = '/v1/p/agents/loop-hook'

/** The harness events a bridge forwards. Each harness spells them its own way. */
export type AgentLoopHookEvent = 'PreToolUse' | 'PostToolUse'

/** What a bridge posts to `POST /v1/p/agents/loop-hook`. The task token, not this body, names the task
 *  and the session. `input` is the harness's hook input as it arrived. */
export type AgentLoopHookRequest = {
  version: typeof LOOP_HOOK_VERSION
  harness: 'claude'
  event: AgentLoopHookEvent
  input: unknown
}

/** The reply. `output` is what the bridge prints, in the harness's own words. `''` is no decision. */
export type AgentLoopHookReply = { version: typeof LOOP_HOOK_VERSION; output: string }

/** The longest a bridged call waits on an ask, and the hook timeout the bridge is installed with.
 *  The hold ends first, so the harness hears a refusal rather than a timed-out hook. */
export const LOOP_HOOK_TIMEOUT_SECONDS = 600
export const LOOP_ASK_HOLD_MS = (LOOP_HOOK_TIMEOUT_SECONDS - 30) * 1_000

/** Which harnesses one plugin's tool hooks reach, for its page in Settings → Plugins. `every` is each
 *  tool call through a bridge, `asked` only the calls the harness asks permission for, through
 *  `agents:before-permission`. Empty when the plugin handles none of the three points. */
export type AgentLoopCoverage = {
  harnesses: { label: string; beforeTool: 'every' | 'asked' | 'none'; afterTool: boolean }[]
}
