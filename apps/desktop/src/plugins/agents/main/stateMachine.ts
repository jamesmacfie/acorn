import type {
  AgentAttentionReason,
  AgentNormalizedEvent,
  AgentRuntimeState,
  AgentSession,
} from '../../../core/shared/managedAgents'

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
export function projectAgentEvent(event: AgentNormalizedEvent): AgentSessionProjection {
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
      return { runtimeState: 'working', attention: 'none' }
    case 'assistant_message':
    case 'reasoning':
    case 'tool':
    case 'plan':
    case 'artifact':
    case 'file_change':
    case 'terminal':
      return { runtimeState: 'working', attention: 'unread' }
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
    case 'usage':
    case 'diagnostic':
      return {}
  }
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
    case 'user_message':
      return {
        ...state,
        runtimeState: 'working',
        attention: 'none',
        activeTurnId: turnId ?? state.activeTurnId,
      }
    case 'assistant_message':
    case 'reasoning':
    case 'tool':
    case 'plan':
    case 'file_change':
    case 'terminal':
    case 'artifact':
      return { ...state, runtimeState: 'working', attention: 'unread', activeTurnId: turnId ?? state.activeTurnId }
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
    case 'usage':
    case 'diagnostic':
      return state
  }
}
