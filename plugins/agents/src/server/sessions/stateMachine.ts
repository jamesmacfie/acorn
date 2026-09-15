import type {
  AgentAttentionReason,
  AgentNormalizedEvent,
  AgentRuntimeState,
  AgentSession,
  AgentSubagent,
  AgentSubagentStatus,
  AgentSubagentUpdate,
} from '@acorn/protocol/managedAgents.ts'

export type AgentMachineState = {
  runtimeState: AgentRuntimeState
  attention: AgentAttentionReason
  activeTurnId: string | null
  pendingRequestIds: string[]
}

export type AgentMachineCommand =
  | { type: 'enqueue_turn' }
  | { type: 'dispatch_turn'; turnId: string }
  | { type: 'cancel_turn' }
  | { type: 'resolve_request'; requestId: string }
  | { type: 'handoff_terminal' }
  | { type: 'resume_managed' }

export type AgentMachineDecision =
  | { ok: true }
  | { ok: false; code: 'not_ready' | 'no_active_turn' | 'request_not_pending' | 'controller_busy'; message: string }

export type AgentSessionProjection = {
  runtimeState?: AgentSession['runtimeState']
  attention?: AgentAttentionReason
  providerSessionRef?: string
  configJson?: string
}

export const initialAgentMachineState = (): AgentMachineState => ({
  runtimeState: 'creating',
  attention: 'none',
  activeTurnId: null,
  pendingRequestIds: [],
})

// The database projection and the richer in-memory reducer share this one pure transition map.
// Provider adapters produce facts; neither persistence nor process supervision invents state.
//
// `turnId` is null for an event that belongs to no turn Acorn dispatched, which is why it gates the
// turn-scoped cases below. A harness can stream after the prompt call it was answering has already
// returned: Claude Code did, five minutes past an `end_turn`, and the trailing message projected
// 'working' onto a session with no turn left to complete it. `turn_completed` is the only event that
// clears 'working', and it only fires as sendTurn's return value, so nothing was coming.
export function projectAgentEvent(
  event: AgentNormalizedEvent,
  turnId: string | null,
): AgentSessionProjection {
  switch (event.type) {
    case 'session_state':
      return {
        runtimeState: event.state,
        attention: event.state === 'failed' ? 'error' : undefined,
      }
    case 'session_metadata':
      return {
        providerSessionRef: event.providerSessionRef,
        configJson: event.configOptions
          ? JSON.stringify({
              configOptions: event.configOptions,
              commands: event.commands ?? [],
              skills: event.skills ?? [],
            })
          : undefined,
      }
    case 'user_message':
      return turnId ? { runtimeState: 'working', attention: 'none' } : {}
    case 'assistant_message':
    case 'reasoning':
    case 'tool':
    case 'plan':
    case 'artifact':
    case 'file_change':
    case 'terminal':
      // Attention still moves without a turn. A stray message is unread content worth a nudge; it is
      // just not evidence that work is in flight.
      return turnId ? { runtimeState: 'working', attention: 'unread' } : { attention: 'unread' }
    case 'request':
      return {
        runtimeState: 'waiting',
        attention: event.kind === 'permission'
          ? 'permission'
          : event.kind === 'workflow_gate'
            ? 'workflow_gate'
            : 'question',
      }
    case 'request_resolved':
      return { runtimeState: 'working', attention: 'none' }
    case 'turn_completed':
      return { runtimeState: 'ready', attention: 'completed' }
    case 'error':
      return { runtimeState: event.retryable ? 'reconnecting' : 'failed', attention: 'error' }
    // A subagent's progress is not the parent's own. Turn boundaries already own the session's state,
    // and projecting 'working' here would let a child that settles after the parent's turn_completed
    // drag the session back out of ready. Codex allows exactly that ordering.
    case 'subagent':
    case 'usage':
    case 'diagnostic':
      return {}
  }
}

// Which statuses still count as work in flight. Everything else is settled, including `idle`: a Codex
// child at rest is resumable rather than finished, which is a display distinction, not a lifecycle one.
const ACTIVE_SUBAGENT_STATUSES: readonly AgentSubagentStatus[] = ['pending', 'running']

export const isActiveSubagent = (entry: AgentSubagent): boolean =>
  ACTIVE_SUBAGENT_STATUSES.includes(entry.status)

/**
 * How long a background child may go quiet before its row stops claiming to be running.
 *
 * A background child never reports that it finished, so the end of a row is always inferred from
 * silence. The number comes from a captured Claude Code run on Sonnet: across two children and 126
 * events, the longest pause between two events from a child that was still working was 16 seconds.
 * A minute is about four times that. Raise it if a child that runs one long command starts flipping
 * to `idle` and back.
 */
export const SUBAGENT_QUIET_MS = 60_000

/** The subagent an event belongs to, when the harness attributed it to one. */
export const eventSubagentId = (event: AgentNormalizedEvent): string | undefined => {
  switch (event.type) {
    case 'tool':
      return event.tool.subagentId
    case 'assistant_message':
    case 'reasoning':
    case 'file_change':
      return event.subagentId
    default:
      return undefined
  }
}

/**
 * Marks a roster row as heard from, returning undefined when there is nothing to write.
 *
 * This is where a background child's liveness actually comes from. Its spawning `Agent` call tells us
 * it started and then never mentions it again, so the roster's own updates stop at the launch receipt
 * while the child streams tool calls for minutes. Those calls carry its id, so they are the one honest
 * report that it is still going, and `updatedAt` becomes the clock `quietedSubagents` reads.
 *
 * Traffic also revives an `idle` row. Quieting is a guess made from silence, and a child that speaks
 * again has just disproved it. A settled row is left alone: a late-arriving tool call must not drag
 * something back out of `completed`.
 */
export function touchSubagentRoster(
  current: AgentSubagent[],
  subagentId: string,
  timestamp: number,
): AgentSubagent[] | undefined {
  const existing = current.find((entry) => entry.id === subagentId)
  if (!existing || existing.status === 'completed' || existing.status === 'failed') return undefined
  return current.map((entry) => entry.id === subagentId
    ? { ...entry, status: entry.status === 'idle' ? 'running' : entry.status, updatedAt: timestamp }
    : entry)
}

/**
 * Which background children have been silent long enough to stop claiming they are running.
 *
 * Only background children: a foreground child is settled by its spawning call's own result, which
 * always arrives, so silence there means the harness is thinking rather than that the child is gone.
 */
export const quietedSubagents = (roster: AgentSubagent[], quietBefore: number): string[] =>
  roster
    .filter((entry) => entry.background && isActiveSubagent(entry) && entry.updatedAt <= quietBefore)
    .map((entry) => entry.id)

// ponytail: keep every in-flight entry plus the last 20 settled ones. The session row is re-serialised
// and broadcast after every event, so an unbounded roster would grow every frame; the full history
// stays in the event ledger, which is what the transcript reads. Give the roster its own table and
// route if a session ever needs more than this at a glance.
const RETAINED_SETTLED_SUBAGENTS = 20

function capSubagentRoster(roster: AgentSubagent[]): AgentSubagent[] {
  const settled = roster.filter((entry) => !isActiveSubagent(entry))
  if (settled.length <= RETAINED_SETTLED_SUBAGENTS) return roster
  const dropped = new Set(
    [...settled]
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(0, settled.length - RETAINED_SETTLED_SUBAGENTS)
      .map((entry) => entry.id),
  )
  // Filtered rather than rebuilt, so the roster keeps spawn order. A fan-out reads as the order it was
  // launched in, and rows that update in place do not jump.
  return roster.filter((entry) => !dropped.has(entry.id))
}

/**
 * Folds one subagent update into the roster, field by field, absent meaning unchanged.
 *
 * Order-robust in both directions, which is a requirement rather than a nicety: on Codex a child
 * thread's own traffic reaches us BEFORE the parent item that names it, so the entry that creates a
 * row is often anonymous and a later update supplies the title. The reverse holds for a harness that
 * only reports usage at completion.
 */
export function foldSubagentRoster(
  current: AgentSubagent[],
  update: AgentSubagentUpdate,
  turnId: string | null,
  timestamp: number,
): AgentSubagent[] {
  const existing = current.find((entry) => entry.id === update.id)
  // Sticky once seen: the spawn learns it is backgrounded before the launch receipt arrives.
  const background = existing?.background || update.background || false
  // A background subagent detaches from the parent's turn. The spawning `Agent` call returns the
  // instant the child launches, so that call's own `completed` is a launch receipt, not the child's
  // finish, and the child's own tool calls stream on well past it. Only a real completion summary
  // settles such a row, and a summary is the one update that carries the harness handle, so a terminal
  // status with no `providerAgentRef` on it is the launch receipt and must not settle the row.
  const settlingFromLaunch = background
    && (update.status === 'completed' || update.status === 'failed')
    && update.providerAgentRef == null
  const merged: AgentSubagent = {
    id: update.id,
    turnId: existing?.turnId ?? turnId,
    title: update.title || existing?.title || 'Subagent',
    status: settlingFromLaunch
      ? existing?.status ?? 'running'
      : update.status ?? existing?.status ?? 'running',
    background: background || undefined,
    role: update.role ?? existing?.role,
    model: update.model ?? existing?.model,
    providerAgentRef: update.providerAgentRef ?? existing?.providerAgentRef,
    usage: update.usage ?? existing?.usage,
    toolUseCount: update.toolUseCount ?? existing?.toolUseCount,
    durationMs: update.durationMs ?? existing?.durationMs,
    startedAt: existing?.startedAt ?? timestamp,
    updatedAt: timestamp,
  }
  return capSubagentRoster(existing
    ? current.map((entry) => entry.id === update.id ? merged : entry)
    : [...current, merged])
}

export function decideAgentCommand(state: AgentMachineState, command: AgentMachineCommand): AgentMachineDecision {
  switch (command.type) {
    case 'enqueue_turn':
      return state.runtimeState === 'failed' || state.runtimeState === 'archived'
        ? { ok: false, code: 'not_ready', message: `Cannot queue a turn while the session is ${state.runtimeState}.` }
        : { ok: true }
    case 'dispatch_turn':
      return state.runtimeState === 'ready' && state.activeTurnId == null
        ? { ok: true }
        : { ok: false, code: 'not_ready', message: `Session is ${state.runtimeState}; it is not protocol-ready.` }
    case 'cancel_turn':
      return state.activeTurnId
        ? { ok: true }
        : { ok: false, code: 'no_active_turn', message: 'The session has no active turn.' }
    case 'resolve_request':
      return state.pendingRequestIds.includes(command.requestId)
        ? { ok: true }
        : { ok: false, code: 'request_not_pending', message: 'The request is no longer pending.' }
    case 'handoff_terminal':
      return state.activeTurnId || state.runtimeState === 'connecting' || state.runtimeState === 'replaying'
        ? { ok: false, code: 'controller_busy', message: 'Finish or cancel the active provider operation before terminal handoff.' }
        : { ok: true }
    case 'resume_managed':
      return state.runtimeState === 'working' || state.runtimeState === 'waiting'
        ? { ok: false, code: 'controller_busy', message: 'The terminal-owned session still has active work.' }
        : { ok: true }
  }
}

export function evolveAgentState(
  state: AgentMachineState,
  event: AgentNormalizedEvent,
  turnId: string | null,
): AgentMachineState {
  switch (event.type) {
    case 'session_state':
      return {
        ...state,
        runtimeState: event.state,
        attention: event.state === 'failed' ? 'error' : state.attention,
        activeTurnId: event.state === 'ready' || event.state === 'stopped' || event.state === 'failed'
          ? null
          : state.activeTurnId,
      }
    case 'user_message': {
      const active = turnId ?? state.activeTurnId
      if (!active) return state
      return { ...state, runtimeState: 'working', attention: 'none', activeTurnId: active }
    }
    case 'assistant_message':
    case 'reasoning':
    case 'tool':
    case 'plan':
    case 'file_change':
    case 'terminal':
    case 'artifact': {
      // Same turn gate as projectAgentEvent, for the same reason. The reducer knows more than the
      // projection does, so it asks whether any turn is in flight rather than just this event's.
      const active = turnId ?? state.activeTurnId
      if (!active) return { ...state, attention: 'unread' }
      return { ...state, runtimeState: 'working', attention: 'unread', activeTurnId: active }
    }
    case 'request':
      return {
        ...state,
        runtimeState: 'waiting',
        attention: event.kind === 'permission'
          ? 'permission'
          : event.kind === 'workflow_gate'
            ? 'workflow_gate'
            : 'question',
        pendingRequestIds: state.pendingRequestIds.includes(event.requestId)
          ? state.pendingRequestIds
          : [...state.pendingRequestIds, event.requestId],
      }
    case 'request_resolved': {
      const pendingRequestIds = state.pendingRequestIds.filter((id) => id !== event.requestId)
      return {
        ...state,
        runtimeState: pendingRequestIds.length === 0 ? 'working' : 'waiting',
        attention: pendingRequestIds.length === 0 ? 'none' : state.attention,
        pendingRequestIds,
      }
    }
    case 'turn_completed':
      return {
        ...state,
        runtimeState: 'ready',
        attention: 'completed',
        activeTurnId: null,
        pendingRequestIds: [],
      }
    case 'error':
      return {
        ...state,
        runtimeState: event.retryable ? 'reconnecting' : 'failed',
        attention: 'error',
        activeTurnId: null,
      }
    case 'session_metadata':
    case 'subagent':
    case 'usage':
    case 'diagnostic':
      return state
  }
}
