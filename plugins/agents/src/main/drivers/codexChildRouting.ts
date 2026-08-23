// Codex subagents, which are full app-server threads sharing the parent's stdio connection.
//
// This is the highest-blast-radius code in the Codex driver, because it decides per notification
// whether traffic reaches the parent session at all. Getting it wrong does not lose a sidebar row, it
// corrupts the parent's lifecycle: a child's `turn/completed` on the parent path ends the parent's
// turn, and a child's `thread/status/changed` flips the parent's runtime state mid-turn.
//
// Verified against a live capture, codex-cli 0.146.1 with gpt-5.6-luna, two children named alpha and
// beta (testFixtures/codexSubagentWire.json). Three things that capture settles:
//
//  1. There is NO `thread/started` for a child on 0.146.1. The root gets one and its `source` is the
//     string "vscode", not an object naming a spawn. A parent-side `subAgentActivity` item is the only
//     registration signal there is.
//  2. Child traffic arrives BEFORE the item that names the child, by one message. So a child registers
//     on first sight by thread id and the naming item only fills in its title later.
//  3. The wire reports `subAgentActivity` about the ROOT (`agentPath: "/root"`), and emits it from a
//     CHILD thread. Registering that makes the session intercept its own final message and
//     turn/completed, and it hangs on "working" forever. Routing keys on the thread a notification
//     arrived on; naming keys on the item's `agentThreadId`. The two are never the same question.
//
// Acorn is stricter than it has to be on one point. Any notification naming a thread that is not the
// root is treated as child traffic, registering that thread if it is unknown, rather than passing an
// unrecognised thread through to the parent. The root thread id is known from `thread/start`, so
// "not the root" is a complete answer, and it is what makes hazard 2 harmless.
import type { AgentNormalizedEvent, AgentSubagentUpdate } from '@acorn/protocol/managedAgents.ts'
import type { JsonRpcNotification } from './jsonRpcProcess'
import { asObject, normalizeCodexNotification, stringValue } from './codexNormalizer'

/** What to do with one notification from a thread that is not the root. */
export type CodexChildRoute =
  // Becomes roster updates and attributed transcript events. Never reaches the parent's own state.
  | 'agent-event'
  // Known chatter with no parent meaning. Named rather than defaulted, so the list is reviewable.
  | 'drop'
  // Parent-owned, or unknown. An unknown method takes this route by design: a Codex release that adds
  // a notification must degrade to "the parent sees it", never to silent loss. Swallowing
  // `serverRequest/resolved` is how t3code left approvals stuck.
  | 'parent'

const CHILD_AGENT_EVENT_METHODS = new Set([
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'thread/closed',
  'turn/started',
  'turn/completed',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
  'item/fileChange/patchUpdated',
  'error',
])

const CHILD_DROPPED_METHODS = new Set([
  // Parent-owned state a child must never drive, and which carries nothing about the child worth
  // showing: its own name, its own plan, its own archive and compaction bookkeeping.
  'thread/started',
  'thread/archived',
  'thread/unarchived',
  'thread/compacted',
  'thread/name/updated',
  'turn/plan/updated',
  'turn/diff/updated',
  'item/plan/delta',
  // Startup noise. Each child announces every MCP server, five times over in the capture.
  'mcpServer/startupStatus/updated',
])

export function routeCodexChildNotification(method: string): CodexChildRoute {
  if (CHILD_AGENT_EVENT_METHODS.has(method)) return 'agent-event'
  if (CHILD_DROPPED_METHODS.has(method)) return 'drop'
  return 'parent'
}

/** The thread a notification is addressed to, however this method spells it. */
export function codexNotificationThreadId(notification: JsonRpcNotification): string | null {
  const thread = asObject(notification.params.thread)
  return stringValue(thread?.id) ?? stringValue(notification.params.threadId)
}

// A path Codex uses for the session's own root rather than for a child.
const ROOT_AGENT_PATHS = new Set(['/root', '/', ''])

/** `/root/alpha` names a subagent called alpha. */
const titleFromAgentPath = (path: string | null): string | undefined =>
  path?.split('/').filter(Boolean).pop() ?? undefined

type ChildState = {
  agentPath: string | null
  /** Whether this child has ever been seen working. A child's first `thread/status/changed` is `idle`,
   *  before it starts, so mapping that to a settled row would flash "Idle" on a subagent that has not
   *  run yet. Idle only means resumable-and-done once it has been active. */
  active: boolean
}

export type CodexRouted =
  /** Not child traffic. The caller normalizes it as the session's own, exactly as before. */
  | { to: 'parent' }
  /** Child traffic, already normalized and attributed. May be empty, which means "handled, say nothing". */
  | { to: 'subagent'; events: AgentNormalizedEvent[] }

/**
 * The child registry for one Codex session. Holds the root thread id and every child thread seen, and
 * turns each notification into either "the parent's" or "this subagent's".
 *
 * Owned by the driver, which is where per-session state belongs; `normalizeCodexNotification` stays a
 * pure function of one notification.
 */
export class CodexChildRouter {
  #rootThreadId: string | null = null
  readonly #children = new Map<string, ChildState>()

  /** Called once the driver knows its thread id, from `thread/start` or `thread/resume`. */
  setRootThread(threadId: string | null): void {
    this.#rootThreadId = threadId
    // A resumed session can learn its root id after traffic has started. Anything registered under
    // that id was the parent all along, and leaving it registered would intercept the parent forever.
    if (threadId) this.#children.delete(threadId)
  }

  route(notification: JsonRpcNotification): CodexRouted {
    const registration = this.#registration(notification)
    if (registration) return registration
    const threadId = codexNotificationThreadId(notification)
    // No thread id, or the session's own: not a subagent's. `account/rateLimits/updated` is the common
    // case with no thread at all.
    if (!threadId || this.#rootThreadId == null || threadId === this.#rootThreadId) return { to: 'parent' }
    const route = routeCodexChildNotification(notification.method)
    if (route === 'parent') return { to: 'parent' }
    const child = this.#ensureChild(threadId, null)
    if (route === 'drop') return { to: 'subagent', events: [] }
    return { to: 'subagent', events: this.#childEvents(notification, threadId, child) }
  }

  /** A parent-side `subAgentActivity` item, which is the one thing that names a child. */
  #registration(notification: JsonRpcNotification): CodexRouted | null {
    if (notification.method !== 'item/started' && notification.method !== 'item/completed') return null
    const item = asObject(notification.params.item)
    if (stringValue(item?.type) !== 'subAgentActivity') return null
    const agentThreadId = stringValue(item?.agentThreadId)
    const agentPath = stringValue(item?.agentPath)
    // The root talking about itself. Swallowed rather than passed on: it is subagent bookkeeping, not
    // anything the parent's transcript wants, and registering it is the hang described at the top.
    if (!agentThreadId || agentThreadId === this.#rootThreadId || ROOT_AGENT_PATHS.has(agentPath ?? '')) {
      return { to: 'subagent', events: [] }
    }
    const child = this.#ensureChild(agentThreadId, agentPath)
    // `started` is the only kind that reports a state, and only for a child that has not already told
    // us something better. Anything else (`interacted`) is a mention, and leaving the status absent
    // keeps whatever the child's own traffic established.
    const started = stringValue(item?.kind) === 'started'
    return {
      to: 'subagent',
      events: [{
        type: 'subagent',
        subagent: {
          id: agentThreadId,
          title: titleFromAgentPath(agentPath),
          role: titleFromAgentPath(agentPath),
          status: started && !child.active ? 'running' : undefined,
        },
      }],
    }
  }

  #ensureChild(threadId: string, agentPath: string | null): ChildState {
    const existing = this.#children.get(threadId)
    if (existing) {
      if (agentPath && !existing.agentPath) existing.agentPath = agentPath
      return existing
    }
    const created: ChildState = { agentPath, active: false }
    this.#children.set(threadId, created)
    return created
  }

  // Normalized once, then translated. Going through `normalizeCodexNotification` rather than reading
  // the wire again means the child path cannot drift from the parent path when a notification's shape
  // changes: usage, statuses, and item mapping all stay stated in exactly one place.
  #childEvents(
    notification: JsonRpcNotification,
    subagentId: string,
    child: ChildState,
  ): AgentNormalizedEvent[] {
    const roster = (subagent: Omit<AgentSubagentUpdate, 'id'>): AgentNormalizedEvent =>
      ({ type: 'subagent', subagent: { id: subagentId, ...subagent } })
    return normalizeCodexNotification(notification).flatMap((event): AgentNormalizedEvent[] => {
      switch (event.type) {
        case 'session_state':
          if (event.state === 'working') {
            child.active = true
            return [roster({ status: 'running' })]
          }
          // Idle is Codex's terminal state for a child: it rests resumable rather than finishing. Until
          // it has been active, though, idle only means "not started yet".
          if (event.state === 'ready') return [roster({ status: child.active ? 'idle' : 'pending' })]
          if (event.state === 'failed') return [roster({ status: 'failed' })]
          if (event.state === 'stopped') return [roster({ status: 'completed' })]
          return []
        case 'usage':
          return [roster({ usage: event.usage })]
        case 'turn_completed':
          return [roster({ status: child.active ? 'idle' : 'completed' })]
        // Kept off the parent's own error path on purpose: a `session_state: failed` or an `error`
        // event here would fail the whole session over one subagent. The row carries the status and a
        // diagnostic carries the words, so the failure is visible without being fatal.
        case 'error':
          return [
            roster({ status: 'failed' }),
            {
              type: 'diagnostic',
              level: 'warning',
              message: `Subagent ${titleFromAgentPath(child.agentPath) ?? subagentId} failed: ${event.message}`,
            },
          ]
        case 'assistant_message':
        case 'reasoning':
          return [{ ...event, subagentId }]
        case 'tool':
          return [{ ...event, tool: { ...event.tool, subagentId } }]
        // A child editing the worktree changed the same files the parent's Changes pane reads, so this
        // one belongs to the session rather than to the subagent, and stays unattributed.
        case 'file_change':
        case 'diagnostic':
          return [event]
        // A child's plan is not the session's plan, and there is nowhere to say whose it is.
        case 'plan':
        case 'user_message':
        case 'session_metadata':
        case 'request':
        case 'request_resolved':
        case 'artifact':
        case 'terminal':
        case 'subagent':
          return []
      }
    })
  }
}
