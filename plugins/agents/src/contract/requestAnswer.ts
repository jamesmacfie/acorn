import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// `agents.requestAnswer`: allow or deny one permission request, once, in a session the calling plugin
// started (docs/managed-agents/session-control.md § Answering a request from a plugin). For a compiled
// plugin that carries approvals somewhere a person reads, such as Slack. Loaded plugins have no grant
// for it.
//
// The value the host provides refuses every answer: a plugin binds its own copy with
// `BIND_CAPABILITY_CALLER`, as with `agents.sessionExecute`, so the session check names the caller.

type AgentRequestAnswerRefusal = 'not-in-task' | 'not-started-by-caller' | 'not-pending' | 'no-once-option'

export type AgentRequestAnswer = {
  answer(input: {
    taskId: string
    sessionId: string
    /** The provider's request ID, as `plugin:agents:request-changed` and `agents.requests` carry it. */
    requestId: string
    decision: 'allow' | 'deny'
    /** The same key answers once, however often it's sent. */
    idempotencyKey: string
  }): Promise<{ ok: true } | { ok: false; reason: AgentRequestAnswerRefusal }>
}

export const AGENTS_REQUEST_ANSWER = capabilityId<AgentRequestAnswer>('agents.requestAnswer')
